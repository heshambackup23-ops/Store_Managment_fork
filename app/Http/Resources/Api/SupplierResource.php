<?php

namespace App\Http\Resources\Api;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SupplierResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'phone' => $this->phone,
            'email' => $this->email,
            'address' => $this->address,
            'opening_balance' => $this->money($this->opening_balance),
            'balance' => $this->money($this->balance),
            'purchases_count' => $this->whenCounted('purchases'),
        ];
    }

    private function money(mixed $value): string
    {
        return number_format((int) round((float) $value * 100) / 100, 2, '.', '');
    }
}
