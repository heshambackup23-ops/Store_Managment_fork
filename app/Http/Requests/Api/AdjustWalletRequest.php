<?php

namespace App\Http\Requests\Api;

use App\Support\Digits;

class AdjustWalletRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge([
            'idempotency_key' => $this->header('Idempotency-Key'),
            'amount' => trim((string) Digits::ascii((string) $this->input('amount'))),
        ]);
    }

    public function authorize(): bool
    {
        return $this->user()?->can('page.wallets.manage') ?? false;
    }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'amount' => ['required', 'numeric', 'decimal:0,2', 'not_in:0', 'between:-99999999,99999999'],
            'reason' => ['required', 'string', 'min:3', 'max:255'],
        ];
    }
}
