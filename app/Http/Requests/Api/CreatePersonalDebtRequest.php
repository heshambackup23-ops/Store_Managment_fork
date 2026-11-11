<?php

namespace App\Http\Requests\Api;

use App\Support\Digits;

class CreatePersonalDebtRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['idempotency_key' => $this->header('Idempotency-Key')]);
        foreach (['total_amount', 'paid_amount'] as $field) {
            if ($this->filled($field)) $this->merge([$field => trim((string) Digits::ascii((string) $this->input($field)))]);
        }
    }

    public function authorize(): bool
    {
        return $this->user()?->can('page.installments.manage') ?? false;
    }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'creditor' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:255'],
            'total_amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:999999999'],
            'paid_amount' => ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:999999999'],
            'due_date' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
