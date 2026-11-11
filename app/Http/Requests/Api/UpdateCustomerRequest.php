<?php

namespace App\Http\Requests\Api;

class UpdateCustomerRequest extends ApiFormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('update-customers', $this->route('customer')) ?? false;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'address' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:20'],
        ];
    }
}
