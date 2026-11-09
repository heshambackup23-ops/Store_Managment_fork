<?php

namespace App\Http\Resources\Api;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InvoiceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'invoice_number' => $this->invoice_number,
            'customer' => $this->customer,
            'invoice_date' => $this->invoice_date?->toDateString(),
            'status' => $this->status,
            'quantity' => (int) $this->quantity,
            'total_amount' => $this->money($this->total_amount),
            'paid_amount' => $this->money($this->paid_amount),
            'remaining_amount' => $this->money((float) $this->total_amount - (float) $this->paid_amount),
            'items' => is_array($this->items) ? $this->items : [],
            'notes' => $this->notes,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }

    private function money(mixed $value): string
    {
        return number_format((int) round((float) $value * 100) / 100, 2, '.', '');
    }
}
