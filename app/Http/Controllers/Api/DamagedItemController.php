<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\RecordDamagedItemRequest;
use App\Http\Requests\Api\UpdateDamagedItemRequest;
use App\Http\Requests\Api\VoidDamagedItemRequest;
use App\Http\Resources\Api\DamagedItemResource;
use App\Models\DamagedItem;
use App\Models\products;
use App\Services\ApiIdempotencyService;
use App\Services\DamagedStockService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DamagedItemController
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:80'],
            'status' => ['nullable', 'in:recorded,voided'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'between:1,100'],
        ]);
        $term = trim((string) ($filters['q'] ?? ''));
        $query = DamagedItem::query()
            ->when($term !== '', fn ($builder) => $builder->where('product_name', 'like', '%'.addcslashes($term, '%_\\').'%'))
            ->when(isset($filters['status']), fn ($builder) => $builder->where('status', $filters['status']))
            ->orderByDesc('damaged_on')->orderByDesc('id');

        return DamagedItemResource::collection($query->paginate($filters['per_page'] ?? 20));
    }

    public function show(DamagedItem $item): DamagedItemResource
    {
        return new DamagedItemResource($item);
    }

    public function products(Request $request): JsonResponse
    {
        $filters = $request->validate(['q' => ['nullable', 'string', 'max:100']]);
        $term = trim((string) ($filters['q'] ?? ''));
        $query = products::query()->where('stock', '>', 0);
        if ($term !== '') {
            $search = '%'.addcslashes($term, '%_\\').'%';
            $query->where(fn ($builder) => $builder->where('name', 'like', $search)->orWhere('barcode', 'like', $search));
        }

        return response()->json(['data' => $query->orderBy('name')->limit(30)->get(['id', 'name', 'barcode', 'price', 'stock'])
            ->map(fn (products $product): array => [
                'id' => $product->id,
                'name' => $product->name,
                'barcode' => $product->barcode,
                'price' => Money::decimal(Money::cents($product->price)),
                'stock' => (int) $product->stock,
            ])->values()]);
    }

    public function store(
        RecordDamagedItemRequest $request,
        ApiIdempotencyService $idempotency,
        DamagedStockService $service,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];

        return $idempotency->execute(
            $request->user(),
            'damaged.create',
            $key,
            $data,
            function () use ($request, $data, $service, $key): array {
                $item = $service->record($data, $request->user(), null, $request->ip());
                return ['status' => 201, 'body' => ['data' => (new DamagedItemResource($item))->resolve($request)]];
            }
        );
    }

    public function update(
        UpdateDamagedItemRequest $request,
        DamagedItem $item,
        ApiIdempotencyService $idempotency,
        DamagedStockService $service,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'damaged.update',
            $key,
            ['item_id' => $item->id] + $data,
            function () use ($request, $item, $service, $data): array {
                $updated = $service->update($item, $data, $request->user(), $request->ip());
                return ['status' => 200, 'body' => ['data' => (new DamagedItemResource($updated))->resolve($request)]];
            }
        );
    }

    public function void(
        VoidDamagedItemRequest $request,
        DamagedItem $item,
        ApiIdempotencyService $idempotency,
        DamagedStockService $service,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];

        return $idempotency->execute(
            $request->user(),
            'damaged.void',
            $key,
            ['item_id' => $item->id, 'reason' => $data['reason']],
            function () use ($request, $item, $service, $data): array {
                $voided = $service->void($item, $data['reason'], $request->user(), $request->ip());
                return ['status' => 200, 'body' => ['data' => (new DamagedItemResource($voided))->resolve($request)]];
            }
        );
    }
}
