<?php

namespace App\Http\Requests\Api;

use App\Models\Wallet;
use App\Support\Digits;
use Illuminate\Validation\Rule;

class CreateWalletRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $identifier = Digits::identifier((string) $this->input('identifier'));
        $this->merge([
            'idempotency_key' => $this->header('Idempotency-Key'),
            'identifier' => $identifier === '' ? null : $identifier,
            'opening_balance' => trim((string) Digits::ascii((string) $this->input('opening_balance', '0'))),
        ]);
    }

    public function authorize(): bool
    {
        return $this->user()?->can('page.wallets.manage') ?? false;
    }

    public function rules(): array
    {
        $provider = (string) $this->input('provider');

        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'name' => ['required', 'string', 'max:100'],
            'provider' => ['required', Rule::in(array_keys(Wallet::PROVIDERS))],
            'identifier' => [
                'nullable', 'string', 'max:64',
                function (string $attribute, mixed $value, \Closure $fail) use ($provider): void {
                    $value = (string) $value;
                    $allowsInstapay = $provider === 'instapay';
                    $valid = Digits::isPhoneNumber($value)
                        || ($allowsInstapay && Digits::isInstapayAddress($value));

                    if (! $valid) {
                        $fail($allowsInstapay
                            ? 'اكتب رقم هاتف صحيح أو عنوان إنستا باي، أو اتركه فارغاً.'
                            : 'اكتب رقم هاتف صحيح، أو اتركه فارغاً.');
                    }
                },
            ],
            'opening_balance' => ['required', 'numeric', 'decimal:0,2', 'min:0', 'max:999999999'],
        ];
    }
}
