<?php

namespace App\Http\Requests\Api;

use App\Models\DamagedItem;
use App\Support\Digits;
use Illuminate\Validation\Rule;

class UpdateDamagedItemRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $merge = ['idempotency_key' => $this->header('Idempotency-Key')];
        foreach (['quantity', 'unit_value'] as $field) {
            if ($this->filled($field)) $merge[$field] = trim((string) Digits::ascii((string) $this->input($field)));
        }
        $this->merge($merge);
    }

    public function authorize(): bool
    {
        return $this->user()?->can('page.damaged.manage') ?? false;
    }

    public function rules(): array
    {
        return [
            'idempotency_key' => ['required', 'string', 'min:16', 'max:64', 'regex:/^[A-Za-z0-9-]+$/'],
            'quantity' => ['required', 'integer', 'min:1', 'max:1000000'],
            'reason' => ['required', Rule::in(array_keys(DamagedItem::REASONS))],
            'unit_value' => ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:9999999'],
            'damaged_on' => ['required', 'date', 'before_or_equal:today'],
            'notes' => ['nullable', 'string', 'max:500'],
        ];
    }
}
