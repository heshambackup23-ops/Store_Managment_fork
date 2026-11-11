<?php

namespace App\Http\Requests\Api;

use Illuminate\Validation\Rule;

class UpdateProductRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge(['idempotency_key' => $this->header('Idempotency-Key')]);
    }

    public function authorize(): bool
    {
        return $this->user()?->can('page.products.manage') ?? false;
    }

    public function rules(): array
    {
        $product = $this->route('product');

        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'name' => ['required', 'string', 'max:255'],
            'price' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:999999.99'],
            'description' => ['nullable', 'string', 'max:2000'],
            'barcode' => ['nullable', 'string', 'max:255', Rule::unique('products', 'barcode')->ignore($product?->id)],
            'stock' => ['required', 'integer', 'min:0', 'max:1000000'],
            'category_id' => ['nullable', 'exists:categories,id'],
        ];
    }
}
