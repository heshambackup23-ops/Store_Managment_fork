<?php

namespace Tests\Feature;

use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1SupplierWriteTest extends TestCase
{
    use RefreshDatabase;

    public function test_supplier_create_is_idempotent_and_initializes_opening_balance(): void
    {
        $token = $this->tokenWithSupplierManagePermission();
        $key = (string) Str::uuid();
        $payload = [
            'name' => 'North Supply',
            'phone' => '01012345678',
            'opening_balance' => '125.25',
            'notes' => 'Private note',
        ];

        $this->withToken($token)
            ->postJson('/api/v1/suppliers', ['name' => 'Missing key'])
            ->assertUnprocessable()
            ->assertJsonPath('error_code', 'VALIDATION_FAILED');

        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/suppliers', $payload)
            ->assertCreated()
            ->assertJsonPath('data.name', 'North Supply')
            ->assertJsonPath('data.opening_balance', '125.25')
            ->assertJsonPath('data.balance', '125.25')
            ->assertJsonMissingPath('data.notes');
        $supplierId = $created->json('data.id');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/suppliers', $payload)
            ->assertCreated()
            ->assertJsonPath('data.id', $supplierId);

        $this->assertSame(1, Supplier::query()->count());
    }

    public function test_supplier_create_requires_manage_permission_and_idempotency_key(): void
    {
        $permission = Permission::query()->create([
            'name' => 'page.suppliers.view',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Supplier viewer', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);
        $token = $user->createToken('supplier-viewer', ['api:me', 'page.suppliers.view']);

        $this->withToken($token->plainTextToken)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/suppliers', ['name' => 'Forbidden'])
            ->assertForbidden();

        $this->assertSame(0, Supplier::query()->count());
    }

    private function tokenWithSupplierManagePermission(): string
    {
        $permission = Permission::query()->create([
            'name' => 'page.suppliers.manage',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Supplier manager', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user->createToken('supplier-manager', [
            'api:me',
            'page.suppliers.view',
            'page.suppliers.manage',
        ])->plainTextToken;
    }
}
