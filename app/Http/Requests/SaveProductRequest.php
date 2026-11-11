<?php

namespace App\Http\Requests;

use App\Support\PictureRules;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SaveProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('page.products.manage') ?? false;
    }

    public function rules(): array
    {
        $product = $this->route('product');

        return [
            'name' => ['required', 'string', 'max:255'],
            // products.price is DECIMAL(8,2): anything above 999999.99 would crash with a database error.
            'price' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:999999.99'],
            'description' => ['required', 'string', 'max:2000'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'barcode' => ['nullable', 'string', 'max:255', Rule::unique('products', 'barcode')->ignore($product?->id)],
            'stock' => ['required', 'integer', 'min:0', 'max:1000000'],
            'category_id' => ['nullable', 'exists:categories,id'],
            'image' => PictureRules::upload(),
            'remove_image' => ['sometimes', 'boolean'],
        ];
    }
}
