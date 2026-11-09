<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\ProductIndexRequest;
use App\Http\Resources\Api\ProductResource;
use App\Models\products;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class ProductController
{
    public function index(ProductIndexRequest $request): AnonymousResourceCollection
    {
        $filters = $request->validated();
        $query = products::query()
            ->select(['id', 'name', 'price', 'description', 'barcode', 'stock', 'category_id', 'image', 'updated_at'])
            ->with('category:id,name')
            ->when(isset($filters['category_id']), fn ($query) => $query->where('category_id', $filters['category_id']))
            ->when(isset($filters['in_stock']), function ($query) use ($filters): void {
                $operator = filter_var($filters['in_stock'], FILTER_VALIDATE_BOOLEAN) ? '>' : '<=';
                $query->where('stock', $operator, 0);
            });

        $term = trim((string) ($filters['q'] ?? ''));
        if ($term !== '') {
            $search = '%'.addcslashes($term, '%_\\').'%';
            $query->where(fn ($query) => $query
                ->where('name', 'like', $search)
                ->orWhere('barcode', 'like', $search));
        }

        return ProductResource::collection(
            $query->orderByDesc('id')->paginate($filters['per_page'] ?? 20)
        );
    }

    public function show(products $product): ProductResource
    {
        return new ProductResource($product->load('category'));
    }
}
