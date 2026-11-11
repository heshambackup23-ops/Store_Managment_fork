<?php

namespace App\Http\Resources\Api;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MaintenanceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'owner' => $this->owner,
            'phone' => $this->phone,
            'address' => $this->address,
            'description' => $this->description,
            'status' => $this->status,
            'requested_date' => $this->requested_date?->toDateString(),
            'completed_date' => $this->completed_date?->toDateString(),
        ];
    }
}
