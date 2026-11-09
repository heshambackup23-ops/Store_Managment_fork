<?php

namespace App\Http\Requests\Api;

class CreateCategoryRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        if ($this->hasHeader('Idempotency-Key')) {
            $this->merge(['idempotency_key' => $this->header('Idempotency-Key')]);
        }
    }

    public function authorize(): bool
    {
        return $this->user()?->can('create-category') ?? false;
    }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'name' => ['required', 'string', 'max:255'],
        ];
    }
}
