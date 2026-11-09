<?php

namespace App\Http\Requests\Api;

use Illuminate\Validation\Rule;

class ProductIndexRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        if ($this->has('in_stock')) {
            $value = filter_var($this->input('in_stock'), FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

            if ($value !== null) {
                $this->merge(['in_stock' => $value]);
            }
        }
    }

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'q' => ['sometimes', 'string', 'max:100'],
            'category_id' => ['sometimes', 'integer', 'min:1', Rule::exists('categories', 'id')],
            'in_stock' => ['sometimes', 'boolean'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
    }
}
