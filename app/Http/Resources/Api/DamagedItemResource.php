<?php

namespace App\Http\Resources\Api;

use App\Models\DamagedItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DamagedItemResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        /** @var DamagedItem $item */
        $item = $this->resource;

        return [
            'id' => $item->id,
            'product_id' => $item->product_id,
            'product_name' => $item->product_name,
            'product_barcode' => $item->product_barcode,
            'quantity' => (int) $item->quantity,
            'unit_value' => number_format((float) $item->unit_value, 2, '.', ''),
            'total_value' => number_format((float) $item->total_value, 2, '.', ''),
            'reason' => $item->reason,
            'reason_label' => $item->reasonLabel(),
            'status' => $item->status,
            'damaged_on' => $item->damaged_on?->toDateString(),
            'notes' => $item->notes,
            'stock_before' => (int) $item->stock_before,
            'stock_after' => (int) $item->stock_after,
            'voided_at' => $item->voided_at?->toIso8601String(),
            'void_reason' => $item->void_reason,
        ];
    }
}
