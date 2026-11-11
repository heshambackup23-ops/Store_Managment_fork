<?php

namespace App\Http\Requests\Api;

class UpdateProductImageRequest extends ApiFormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('page.products.manage') ?? false;
    }

    public function rules(): array
    {
        return ['image' => ['required', 'image', 'mimes:jpg,jpeg,png,webp', 'max:12288']];
    }
}
