<?php

namespace App\Http\Requests\Api;

class UpdateInvoiceRequest extends CreateInvoiceRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('update-invoice') ?? false;
    }
}
