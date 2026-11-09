<?php

namespace App\Http\Requests;

use App\Models\Wallet;
use App\Support\Digits;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SaveWalletRequest extends FormRequest
{
    private const MONEY_FIELDS = [
        'opening_balance', 'per_transaction_limit', 'daily_send_limit', 'daily_receive_limit',
        'monthly_send_limit', 'monthly_receive_limit', 'default_commission_percent',
        'default_commission_min', 'default_fee_percent', 'default_fee_min', 'default_fee_max',
    ];

    public function authorize(): bool
    {
        return $this->user()?->can('page.wallets.manage') ?? false;
    }

    protected function prepareForValidation(): void
    {
        $merge = [
            'identifier' => Digits::identifier((string) $this->input('identifier')),
            'is_active' => $this->boolean('is_active'),
        ];

        // Accept Arabic-Indic digits in the number fields.
        foreach (self::MONEY_FIELDS as $field) {
            if ($this->filled($field)) {
                $merge[$field] = trim((string) Digits::ascii((string) $this->input($field)));
            }
        }

        $this->merge($merge);
    }

    /**
     * Every field is optional. Two wallets may share the same name or number, so there is
     * no unique rule. When a number IS typed it is still checked, to catch typing mistakes.
     */
    public function rules(): array
    {
        $wallet = $this->route('wallet');
        $provider = (string) $this->input('provider');
        $money = ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:999999999'];

        $rules = [
            'name' => ['nullable', 'string', 'max:100'],
            'provider' => ['nullable', Rule::in(array_keys(Wallet::PROVIDERS))],
            'identifier' => [
                'nullable', 'string', 'max:64',
                function (string $attribute, mixed $value, \Closure $fail) use ($provider): void {
                    $value = (string) $value;
                    $allowsInstapay = $provider === '' || $provider === 'instapay';
                    $valid = Digits::isPhoneNumber($value)
                        || ($allowsInstapay && Digits::isInstapayAddress($value));

                    if (! $valid) {
                        $fail($allowsInstapay
                            ? 'اكتب رقم هاتف صحيح أو عنوان إنستا باي (مثل name@instapay)، أو اتركه فارغاً.'
                            : 'اكتب رقم هاتف صحيح (أرقام فقط، من 6 إلى 15 رقماً)، أو اتركه فارغاً.');
                    }
                },
            ],
            'holder_name' => ['nullable', 'string', 'max:100'],
            'per_transaction_limit' => $money,
            'daily_send_limit' => $money,
            'daily_receive_limit' => $money,
            'monthly_send_limit' => $money,
            'monthly_receive_limit' => $money,
            'warn_at_percent' => ['nullable', 'integer', 'between:1,100'],
            'default_commission_percent' => ['nullable', 'numeric', 'decimal:0,2', 'between:0,100'],
            'default_commission_min' => $money,
            'default_fee_percent' => ['nullable', 'numeric', 'decimal:0,2', 'between:0,100'],
            'default_fee_min' => $money,
            'default_fee_max' => $money,
            'is_active' => ['required', 'boolean'],
            'notes' => ['nullable', 'string', 'max:500'],
        ];

        // The opening balance is set once, when the wallet is created. After that
        // the balance only moves through the ledger (transactions or adjustments).
        if (! $wallet) {
            $rules['opening_balance'] = $money;
        }

        return $rules;
    }

    /**
     * The validated data, ready to save: empty text becomes NULL and empty numbers
     * take their default (the database columns for those cannot be NULL).
     */
    public function walletAttributes(): array
    {
        $data = $this->validated();

        foreach (['warn_at_percent' => 80, 'default_commission_percent' => 0, 'default_commission_min' => 0, 'default_fee_percent' => 0, 'default_fee_min' => 0] as $key => $default) {
            if (($data[$key] ?? null) === null || $data[$key] === '') {
                $data[$key] = $default;
            }
        }

        foreach (['name', 'provider', 'identifier', 'holder_name', 'notes'] as $key) {
            $text = isset($data[$key]) ? trim((string) $data[$key]) : '';
            $data[$key] = $text === '' ? null : $text;
        }

        return $data;
    }

    public function attributes(): array
    {
        return [
            'name' => 'اسم المحفظة',
            'provider' => 'نوع المحفظة',
            'identifier' => 'رقم المحفظة',
            'holder_name' => 'اسم صاحب المحفظة',
            'opening_balance' => 'الرصيد الافتتاحي',
            'per_transaction_limit' => 'حد العملية الواحدة',
            'daily_send_limit' => 'حد التحويل اليومي',
            'daily_receive_limit' => 'حد الاستلام اليومي',
            'monthly_send_limit' => 'حد التحويل الشهري',
            'monthly_receive_limit' => 'حد الاستلام الشهري',
            'warn_at_percent' => 'نسبة التنبيه',
            'default_commission_percent' => 'نسبة العمولة',
            'default_commission_min' => 'أقل عمولة',
            'default_fee_percent' => 'نسبة رسوم المزود',
            'default_fee_min' => 'أقل رسوم',
            'default_fee_max' => 'أقصى رسوم',
            'notes' => 'ملاحظات',
        ];
    }
}
