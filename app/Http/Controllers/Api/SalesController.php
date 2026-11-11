<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\SalesIndexRequest;
use App\Http\Resources\Api\SoldProductResource;
use App\Models\products as Product;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class SalesController
{
    public function index(SalesIndexRequest $request): AnonymousResourceCollection
    {
        $filters = $request->validated();
        $term = trim((string) ($filters['q'] ?? ''));
        $query = Product::query()
            ->select(['id', 'name'])
            ->selectRaw('total_sold as sold_quantity')
            ->where('total_sold', '>', 0);

        if ($term !== '') {
            $query->where('name', 'like', '%'.addcslashes($term, '%_\\').'%');
        }

        return SoldProductResource::collection(
            $query->orderByDesc('total_sold')->orderBy('name')->paginate($filters['per_page'] ?? 20)
        );
    }
}
