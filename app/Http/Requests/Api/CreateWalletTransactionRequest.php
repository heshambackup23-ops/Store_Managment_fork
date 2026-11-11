<?php

namespace App\Http\Requests\Api;

use App\Support\Digits;
use Illuminate\Validation\Rule;

class CreateWalletTransactionRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $merge = ['idempotency_key' => $this->header('Idempotency-Key')];
        foreach (['amount', 'commission', 'fee'] as $field) {
            if ($this->filled($field)) {
                $merge[$field] = trim((string) Digits::ascii((string) $this->input($field)));
            }
        }
        $merge['counterparty'] = Digits::identifier((string) $this->input('counterparty'));
        $this->merge($merge);
    }

    public function authorize(): bool
    {
        return $this->user()?->can('page.wallet_cashier.manage') ?? false;
    }

    public function rules(): array
    {
        $money = ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:99999999'];

        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'wallet_id' => ['required', 'integer', Rule::exists('wallets', 'id')->where('is_active', true)],
            'type' => ['required', Rule::in(['send', 'receive'])],
            'amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:99999999'],
            'counterparty' => [
                'required', 'string', 'max:64',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    if (! Digits::isPhoneOrInstapay((string) $value)) {
                        $fail('اكتب رقم هاتف صحيح أو عنوان إنستا باي.');
                    }
                },
            ],
            'commission' => $money,
            'fee' => $money,
            'payment_method' => ['nullable', Rule::in(['cash', 'deferred'])],
            'customer_id' => ['nullable', 'integer', 'exists:customers,id'],
            'customer_name' => ['nullable', 'string', 'max:120'],
            'notes' => ['nullable', 'string', 'max:500'],
        ];
    }
}
