<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use App\Support\PictureRules;

class SaveMaintenanceRequest extends FormRequest
{
    public function authorize(): bool
    {
        // Was "any logged-in user". Now matches products: only roles with Manage
        // on the maintenance page (and the superadmin) can create or edit records.
        return $this->user()?->can('page.maintenance.manage') ?? false;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'owner' => ['required', 'string', 'max:255'],
            'description' => ['required', 'string'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'status' => ['required', 'string', Rule::in(['قيد الانتظار', 'مكتمل'])],
            'phone' => ['required', 'string', 'max:32'],
            'address' => ['required', 'string', 'max:255'],
            'requested_date' => $this->isMethod('post')
                ? ['required', 'date']
                : ['sometimes', 'required', 'date'],
            'image' => PictureRules::upload(),
            'remove_image' => ['sometimes', 'boolean'],
        ];
    }
}
