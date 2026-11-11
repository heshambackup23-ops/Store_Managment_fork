<?php

namespace App\Http\Resources\Api;

use App\Models\PersonalDebt;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PersonalDebtResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        /** @var PersonalDebt $debt */
        $debt = $this->resource;

        return [
            'id' => $debt->id,
            'creditor' => $debt->creditor,
            'description' => $debt->description,
            'total_amount' => number_format((float) $debt->total_amount, 2, '.', ''),
            'paid_amount' => number_format((float) $debt->paid_amount, 2, '.', ''),
            'remaining' => number_format((float) $debt->remaining, 2, '.', ''),
            'due_date' => $debt->due_date?->toDateString(),
            'status' => $debt->status,
            'notes' => $debt->notes,
            'payments' => $debt->relationLoaded('payments') ? $debt->payments->map(fn ($payment): array => [
                'id' => $payment->id,
                'amount' => number_format((float) $payment->amount, 2, '.', ''),
                'paid_on' => $payment->paid_on?->toDateString(),
                'notes' => $payment->notes,
            ])->values() : [],
        ];
    }
}
