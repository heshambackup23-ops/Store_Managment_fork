<?php

namespace App\Http\Requests\Api;

class UpdateCategoryRequest extends ApiFormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('update-category', $this->route('category')) ?? false;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
        ];
    }
}
