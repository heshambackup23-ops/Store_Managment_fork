<?php

namespace App\Http\Requests\Api;

use App\Support\Digits;

class CashierCheckoutRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge([
            'idempotency_key' => $this->header('Idempotency-Key'),
            'received' => $this->filled('received') ? trim((string) Digits::ascii((string) $this->input('received'))) : null,
        ]);
    }

    public function authorize(): bool
    {
        return $this->user()?->can('create-invoice') ?? false;
    }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'customer' => ['nullable', 'string', 'max:255'],
            'items' => ['required', 'array', 'min:1', 'max:100'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:100000'],
            'received' => ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:99999999'],
        ];
    }
}
