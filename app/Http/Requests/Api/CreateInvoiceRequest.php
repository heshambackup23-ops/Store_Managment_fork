<?php

namespace App\Http\Requests\Api;

class CreateInvoiceRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        if ($this->hasHeader('Idempotency-Key')) {
            $this->merge(['idempotency_key' => $this->header('Idempotency-Key')]);
        }
    }

    public function authorize(): bool
    {
        return $this->user()?->can('create-invoice') ?? false;
    }

    public function rules(): array
    {
        $productIds = $this->input('product_ids', []);
        $count = is_array($productIds) ? count($productIds) : 0;

        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'customer' => ['required', 'string', 'max:255'],
            'product_ids' => ['required', 'array', 'min:1', 'max:100'],
            'product_ids.*' => ['required', 'integer', 'min:1'],
            'quantities' => ['required', 'array', 'size:'.$count, 'max:100'],
            'quantities.*' => ['required', 'integer', 'min:1', 'max:100000'],
            'invoice_date' => ['required', 'date'],
            'paid_amount' => ['required', 'numeric', 'decimal:0,2', 'min:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ];
    }
}
