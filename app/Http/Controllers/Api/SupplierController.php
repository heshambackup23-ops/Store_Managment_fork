<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\SupplierIndexRequest;
use App\Http\Requests\Api\CreateSupplierRequest;
use App\Http\Requests\Api\UpdateSupplierRequest;
use App\Http\Requests\Api\DeleteSupplierRequest;
use App\Http\Resources\Api\SupplierResource;
use App\Models\Supplier;
use App\Services\ApiIdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

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

    public function update(UpdateSupplierRequest $request, Supplier $supplier, ApiIdempotencyService $idempotency): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute($request->user(), 'suppliers.update', $key, ['supplier_id' => $supplier->id] + $data,
            function () use ($request, $supplier, $data): array {
                $updated = DB::transaction(function () use ($supplier, $data): Supplier {
                    $locked = Supplier::query()->lockForUpdate()->findOrFail($supplier->id);
                    $oldOpening = (int) round((float) $locked->opening_balance * 100);
                    $newOpening = (int) round((float) ($data['opening_balance'] ?? 0) * 100);
                    $newBalance = max(0, (int) round((float) $locked->balance * 100) + $newOpening - $oldOpening);
                    $locked->update([
                        'name' => $data['name'], 'phone' => $data['phone'] ?? null,
                        'email' => $data['email'] ?? null, 'address' => $data['address'] ?? null,
                        'notes' => $data['notes'] ?? null,
                        'opening_balance' => number_format($newOpening / 100, 2, '.', ''),
                        'balance' => number_format($newBalance / 100, 2, '.', ''),
                    ]);
                    return $locked->refresh()->loadCount('purchases');
                }, 3);

                return ['status' => 200, 'body' => ['data' => (new SupplierResource($updated))->resolve($request)]];
            });
    }

    public function destroy(DeleteSupplierRequest $request, Supplier $supplier, ApiIdempotencyService $idempotency): JsonResponse
    {
        $key = $request->validated('idempotency_key');
        return $idempotency->execute($request->user(), 'suppliers.delete', $key, ['supplier_id' => $supplier->id],
            function () use ($supplier): array {
                DB::transaction(function () use ($supplier): void {
                    $locked = Supplier::query()->lockForUpdate()->findOrFail($supplier->id);
                    $locked->delete(); // Related purchases and payment history cascade by schema design.
                }, 3);
                return ['status' => 204, 'body' => []];
            });
    }
}
