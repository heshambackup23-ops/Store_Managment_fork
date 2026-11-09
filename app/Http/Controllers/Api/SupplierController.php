<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\SupplierIndexRequest;
use App\Http\Resources\Api\SupplierResource;
use App\Models\Supplier;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class SupplierController
{
    public function index(SupplierIndexRequest $request): AnonymousResourceCollection
    {
        $filters = $request->validated();
        $query = Supplier::query()
            ->select(['id', 'name', 'phone', 'email', 'address', 'opening_balance', 'balance'])
            ->withCount('purchases');
        $term = trim((string) ($filters['q'] ?? ''));

        if ($term !== '') {
            $search = '%'.addcslashes($term, '%_\\').'%';
            $query->where(fn ($query) => $query
                ->where('name', 'like', $search)
                ->orWhere('phone', 'like', $search)
                ->orWhere('email', 'like', $search));
        }

        return SupplierResource::collection(
            $query->orderByDesc('balance')->orderBy('name')->paginate($filters['per_page'] ?? 20)
        );
    }

    public function show(Supplier $supplier): SupplierResource
    {
        return new SupplierResource($supplier->loadCount('purchases'));
    }
}