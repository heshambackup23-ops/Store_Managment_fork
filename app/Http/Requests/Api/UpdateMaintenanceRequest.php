<?php

namespace App\Http\Requests\Api;

use Illuminate\Validation\Rule;

class UpdateMaintenanceRequest extends ApiFormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('page.maintenance.manage') ?? false;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'owner' => ['required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:32'],
            'address' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'status' => ['required', Rule::in(['قيد الانتظار', 'قيد الصيانة', 'مكتمل', 'مرفوض'])],
            'requested_date' => ['required', 'date'],
        ];
    }
}
