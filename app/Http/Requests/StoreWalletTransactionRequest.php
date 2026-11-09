<?php

namespace App\Http\Requests;

use App\Support\Digits;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreWalletTransactionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('page.wallet_cashier.manage') ?? false;
    }

    protected function prepareForValidation(): void
    {
        $merge = ['counterparty' => Digits::identifier((string) $this->input('counterparty'))];

        // Arabic-Indic digits become ASCII. A comma is NOT guessed: "1,500" must fail
        // validation instead of silently becoming 1.50.
        foreach (['amount', 'commission', 'fee'] as $field) {
            if ($this->filled($field)) {
                $merge[$field] = trim((string) Digits::ascii((string) $this->input($field)));
            }
        }

        $this->merge($merge);
    }

    public function rules(): array
    {
        $money = ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:99999999'];

        return [
            'wallet_id' => ['required', 'integer', Rule::exists('wallets', 'id')->where('is_active', true)],
            'type' => ['required', Rule::in(['send', 'receive'])],
            'amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:99999999'],
            'counterparty' => [
                'required', 'string', 'max:64',
                function (string $attribute, mixed $value, \Closure $fail): void {
                    $value = (string) $value;

                    if (! Digits::isPhoneOrInstapay($value)) {
                        $fail('اكتب رقم هاتف صحيح (أرقام فقط، من 6 إلى 15 رقماً، ويمكن أن يبدأ بـ +) أو عنوان إنستا باي.');
                    }
                },
            ],
            'commission' => $money,
            'fee' => $money,
            'payment_method' => ['nullable', Rule::in(['cash', 'deferred'])],
            'customer_id' => ['nullable', 'integer', 'exists:customers,id'],
            'customer_name' => ['nullable', 'string', 'max:120'],
            'notes' => ['nullable', 'string', 'max:500'],
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9\-]+$/'],
        ];
    }

    public function attributes(): array
    {
        return [
            'wallet_id' => 'المحفظة',
            'type' => 'نوع العملية',
            'amount' => 'المبلغ',
            'counterparty' => 'رقم الطرف الآخر',
            'commission' => 'العمولة',
            'fee' => 'رسوم المزود',
            'payment_method' => 'طريقة الدفع',
            'customer_name' => 'اسم العميل',
            'notes' => 'الملاحظات',
        ];
    }
}
