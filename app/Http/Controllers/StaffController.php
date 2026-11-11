<?php

namespace App\Http\Controllers;

use App\Http\Requests\SaveStaffUserRequest;
use App\Models\NotificationRead;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Role;

class StaffController extends Controller
{
    public function index(Request $request)
    {
        $search = trim((string) $request->query('search', ''));
        $like = '%'.addcslashes($search, '%_\\').'%';

        $users = User::query()
            ->with('roles:id,name')
            ->when($search !== '', function ($query) use ($like): void {
                $query->where(function ($query) use ($like): void {
                    $query->where('username', 'like', $like)
                        ->orWhere('name', 'like', $like);
                });
            })
            ->orderBy('name')
            ->paginate(20)
            ->withQueryString();

        return view('users.index', compact('users', 'search'));
    }

    public function show(User $user)
    {
        $user->load('roles:id,name');

        return view('users.show', compact('user'));
    }

    public function create(Request $request)
    {
        $this->ensureSuperadmin($request);
        $roles = $this->assignableRoles();

        return view('users.create', compact('roles'));
    }

    public function store(SaveStaffUserRequest $request)
    {
        $validated = $request->validated();
        $role = $this->assignableRole($validated['role_id']);

        DB::transaction(function () use ($validated, $role): void {
            $user = new User();
            $user->forceFill([
                'username' => $validated['username'],
                'name' => $validated['name'],
                'email' => $validated['email'] ?? $this->availableEmail($validated['username']),
                'password' => $validated['password'],
                'role' => $this->legacyRole($role),
                'is_active' => (bool) $validated['is_active'],
            ]);
            $user->save();
            $user->syncRoles([$role]);
        });

        return redirect()->route('users.index')->with('success', 'تم إنشاء حساب الموظف.');
    }

    public function edit(User $user, Request $request)
    {
        $this->ensureSuperadmin($request);
        abort_if($user->system_account || $user->isSuperAdmin(), 403);
        $roles = $this->assignableRoles();

        return view('users.edit', compact('user', 'roles'));
    }

    public function update(SaveStaffUserRequest $request, User $user)
    {
        $validated = $request->validated();
        $role = $this->assignableRole($validated['role_id']);
        $passwordChanged = filled($validated['password'] ?? null)
            && !Hash::check($validated['password'], $user->getAuthPassword());
        $roleChanged = !$user->hasRole($role);
        $accountDisabled = !(bool) $validated['is_active'];

        DB::transaction(function () use ($validated, $role, $user, $passwordChanged, $roleChanged, $accountDisabled): void {
            $user->forceFill([
                'username' => $validated['username'],
                'name' => $validated['name'],
                'email' => $validated['email'] ?? $user->email,
                'role' => $this->legacyRole($role),
                'is_active' => (bool) $validated['is_active'],
            ]);

            if (filled($validated['password'] ?? null)) {
                $user->password = $validated['password'];
            }

            $user->save();
            $user->syncRoles([$role]);

            if ($passwordChanged || $roleChanged || $accountDisabled) {
                $user->tokens()->delete();
            }

            // A reset password or a disabled account must also end the sessions that are already open.
            if (($accountDisabled || $passwordChanged) && Schema::hasTable('sessions')) {
                DB::table('sessions')->where('user_id', $user->id)->delete();
            }
        });

        return redirect()->route('users.index')->with('success', 'تم تحديث حساب الموظف.');
    }

    public function destroy(User $user, Request $request)
    {
        $this->ensureSuperadmin($request);
        abort_if($request->user()->is($user) || $user->system_account || $user->isSuperAdmin(), 403);

        $photo = $user->photo;

        try {
            DB::transaction(function () use ($user): void {
                $user->tokens()->delete();
                NotificationRead::where('user_id', $user->id)->delete();
                $user->syncRoles([]);

                if (Schema::hasTable('sessions')) {
                    DB::table('sessions')->where('user_id', $user->id)->delete();
                }

                $user->delete();
            });
        } catch (QueryException $exception) {
            // Usually a foreign key: the account already has records linked to it.
            report($exception);

            return redirect()->route('users.index')
                ->with('error', 'تعذر حذف الحساب لأن له سجلات مرتبطة. عطّل الحساب بدلاً من حذفه.');
        }

        // The picture file is removed only after the account is really gone.
        if ($photo && basename($photo) === $photo) {
            File::delete(public_path('uploads/users/'.$photo));
        }

        return redirect()->route('users.index')->with('success', 'تم حذف حساب الموظف.');
    }

    private function ensureSuperadmin(Request $request): void
    {
        abort_unless($request->user()?->isSuperAdmin(), 403);
    }

    private function assignableRoles()
    {
        return Role::query()->where('guard_name', 'web')->where('name', '!=', 'Superadmin')
            ->orderBy('name')->get(['id', 'name']);
    }

    private function assignableRole(int|string $roleId): Role
    {
        $role = Role::query()->where('guard_name', 'web')->findOrFail($roleId);
        abort_if(Str::lower($role->name) === 'superadmin', 403);

        return $role;
    }

    private function legacyRole(Role $role): string
    {
        return $role->name === 'Admin' ? 'admin' : 'cashier';
    }

    private function availableEmail(string $username): string
    {
        $base = Str::lower($username).'@users.local';
        $candidate = $base;
        $suffix = 1;

        while (User::query()->where('email', $candidate)->exists()) {
            $candidate = Str::before($base, '@').'-'.$suffix++.'@users.local';
        }

        return $candidate;
    }
}
