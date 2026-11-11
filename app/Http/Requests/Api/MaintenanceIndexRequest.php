<?php

namespace App\Http\Requests\Api;

class MaintenanceIndexRequest extends ApiFormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('page.maintenance.view') ?? false;
    }

    public function rules(): array
    {
        return [
            'q' => ['nullable', 'string', 'max:80'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ];
    }
}
