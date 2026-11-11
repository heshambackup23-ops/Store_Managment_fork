<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\SupplierIndexRequest;
use App\Http\Requests\Api\CreateSupplierRequest;
use App\Http\Resources\Api\SupplierResource;
use App\Models\Supplier;
use App\Services\ApiIdempotencyService;
use Illuminate\Http\JsonResponse;
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

    public function store(CreateSupplierRequest $request, ApiIdempotencyService $idempotency): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);
        $openingBalance = number_format((int) round((float) ($data['opening_balance'] ?? 0) * 100) / 100, 2, '.', '');

        return $idempotency->execute(
            $request->user(),
            'suppliers.create',
            $key,
            $data,
            function () use ($request, $data, $openingBalance): array {
                $supplier = Supplier::query()->create([
                    'name' => $data['name'],
                    'phone' => $data['phone'] ?? null,
                    'email' => $data['email'] ?? null,
                    'address' => $data['address'] ?? null,
                    'opening_balance' => $openingBalance,
                    'balance' => $openingBalance,
                    'notes' => $data['notes'] ?? null,
                ]);

                return [
                    'status' => 201,
                    'body' => ['data' => (new SupplierResource($supplier))->resolve($request)],
                ];
            }
        );
    }
}
