<?php

namespace App\Http\Resources\Api;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'price' => number_format((int) round((float) $this->price * 100) / 100, 2, '.', ''),
            'description' => $this->description,
            'notes' => $this->notes,
            'barcode' => $this->barcode,
            'stock' => (int) $this->stock,
            'category' => $this->whenLoaded('category', fn () => $this->category ? [
                'id' => $this->category->id,
                'name' => $this->category->name,
            ] : null),
            'image_url' => $this->image_url,
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
