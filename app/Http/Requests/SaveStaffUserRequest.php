<?php

namespace App\Http\Requests;

use App\Support\AssignableRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SaveStaffUserRequest extends FormRequest
{
    protected function prepareForValidation(): void
    {
        $normalized = [
            // An unchecked checkbox sends nothing. Treat "missing" as false so a
            // user can actually be deactivated instead of failing validation.
            'is_active' => $this->boolean('is_active'),
        ];

        if ($this->filled('username')) {
            $normalized['username'] = mb_strtolower(trim((string) $this->input('username')));
        }

        $this->merge($normalized);
    }

    public function authorize(): bool
    {
        $target = $this->route('user');

        return $this->user()?->isSuperAdmin()
            && (!$target || (!$target->system_account && !$target->isSuperAdmin()));
    }

    public function rules(): array
    {
        $target = $this->route('user');

        return [
            'username' => [
                'required',
                'string',
                'max:80',
                'regex:/^[A-Za-z0-9._-]+$/',
                Rule::unique('users', 'username')->ignore($target?->id),
            ],
            'name' => ['required', 'string', 'max:255'],
            'email' => [
                'nullable', 'email', 'max:255',
                Rule::unique('users', 'email')->ignore($target?->id),
            ],
            'role_id' => [
                'required',
                'integer',
                AssignableRole::rule(),
            ],
            'password' => $target
                ? ['nullable', 'string', 'min:10', 'confirmed']
                : ['required', 'string', 'min:10', 'confirmed'],
            'is_active' => ['required', 'boolean'],
        ];
    }
}
