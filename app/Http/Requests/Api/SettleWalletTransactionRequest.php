<?php

namespace App\Http\Requests\Api;

use App\Support\Digits;

class SettleWalletTransactionRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge([
            'idempotency_key' => $this->header('Idempotency-Key'),
            'amount' => $this->filled('amount') ? trim((string) Digits::ascii((string) $this->input('amount'))) : null,
        ]);
    }

    public function authorize(): bool
    {
        return $this->user()?->can('page.wallet_cashier.manage') ?? false;
    }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'amount' => ['nullable', 'numeric', 'decimal:0,2', 'min:0.01', 'max:99999999'],
        ];
    }
}
