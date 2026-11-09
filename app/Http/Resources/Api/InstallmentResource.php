<?php

namespace App\Http\Resources\Api;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InstallmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'invoice_id' => $this->invoice_id,
            'customer_id' => $this->customer_id,
            'customer' => $this->customer,
            'product_id' => $this->product_id,
            'product_name' => $this->product_name,
            'product_price' => $this->money($this->product_price),
            'payment_date' => $this->payment_date?->toDateString(),
            'next_payment_date' => $this->next_payment_date?->toDateString(),
            'paid_amount' => $this->money($this->paid_amount),
            'remaining' => $this->money($this->remaining),
            'quantity' => (int) $this->quantity,
            'status' => $this->status,
            'items' => is_array($this->items) ? $this->items : [],
        ];
    }

    private function money(mixed $value): string
    {
        return number_format((int) round((float) $value * 100) / 100, 2, '.', '');
    }
}
