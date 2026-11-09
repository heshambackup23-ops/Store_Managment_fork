<?php

namespace App\Http\Requests\Api;

class IssueTokenRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        if ($this->filled('username')) {
            $this->merge(['username' => mb_strtolower(trim((string) $this->input('username')))]);
        }

        if ($this->filled('device_name')) {
            $this->merge(['device_name' => trim((string) $this->input('device_name'))]);
        }
    }

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'username' => ['required', 'string', 'max:80', 'regex:/^[a-z0-9._-]+$/'],
            'password' => ['required', 'string', 'max:1024'],
            'device_name' => ['required', 'string', 'min:1', 'max:80'],
        ];
    }
}
