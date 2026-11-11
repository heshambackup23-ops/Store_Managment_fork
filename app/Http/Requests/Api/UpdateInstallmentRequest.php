<?php

namespace App\Http\Requests\Api;

class UpdateInstallmentRequest extends ApiFormRequest
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
        $productIds = $this->input('product_ids', []);
        $count = is_array($productIds) ? count($productIds) : 0;

        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'customer' => ['required', 'string', 'max:255'],
            'product_ids' => ['required_without:product_name', 'array', 'min:1', 'max:100'],
            'product_ids.*' => ['required_with:product_ids', 'integer'],
            'quantities' => ['required_with:product_ids', 'array', 'size:'.$count, 'max:100'],
            'quantities.*' => ['required_with:product_ids', 'integer', 'min:1', 'max:100000'],
            'product_name' => ['required_without:product_ids', 'string', 'max:255'],
            'total_amount' => ['required_without:product_ids', 'numeric', 'decimal:0,2', 'min:0.01', 'max:99999999'],
            'payment_date' => ['nullable', 'date'],
            'next_payment_date' => ['nullable', 'date'],
            'paid_amount' => ['required', 'numeric', 'decimal:0,2', 'min:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
