<?php

namespace App\Http\Requests\Api;

class UpdateInstallmentStatusRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['idempotency_key' => $this->header('Idempotency-Key')]);
    }

    public function authorize(): bool
    {
        return $this->user()?->can('page.installments.manage') ?? false;
    }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'status' => ['required', 'string', 'in:غير مكتمل,متأخر,مكتمل'],
        ];
    }
}
