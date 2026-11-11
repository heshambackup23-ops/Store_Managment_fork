<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\ProductIndexRequest;
use App\Http\Requests\Api\CreateProductRequest;
use App\Http\Requests\Api\UpdateProductRequest;
use App\Http\Requests\Api\UpdateProductImageRequest;
use App\Http\Requests\Api\DeleteProductRequest;
use App\Http\Resources\Api\ProductResource;
use App\Models\products;
use App\Services\ApiIdempotencyService;
use App\Services\PictureStorageService;
use App\Models\invoice as Invoice;
use App\Models\installments as Installment;
use Illuminate\Support\Facades\DB;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\ValidationException;

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

    public function store(CreateProductRequest $request, ApiIdempotencyService $idempotency): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'products.create',
            $key,
            $data,
            function () use ($request, $data): array {
                if (! empty($data['barcode']) && products::query()->where('barcode', $data['barcode'])->exists()) {
                    throw ValidationException::withMessages(['barcode' => 'قيمة الباركود مستخدمة من قبل.']);
                }

                $product = products::query()->create($data)->load('category');

                return [
                    'status' => 201,
                    'body' => ['data' => (new ProductResource($product))->resolve($request)],
                ];
            }
        );
    }

    public function update(
        UpdateProductRequest $request,
        products $product,
        ApiIdempotencyService $idempotency,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'products.update',
            $key,
            ['product_id' => $product->id] + $data,
            function () use ($request, $product, $data): array {
                $updated = DB::transaction(function () use ($product, $data): products {
                    $locked = products::query()->lockForUpdate()->findOrFail($product->id);
                    $locked->update($data);
                    return $locked->refresh()->load('category');
                }, 3);

                return ['status' => 200, 'body' => ['data' => (new ProductResource($updated))->resolve($request)]];
            }
        );
    }

    public function updateImage(UpdateProductImageRequest $request, products $product, PictureStorageService $pictures): JsonResponse
    {
        $newPath = $pictures->store($request->file('image'), 'products');
        $oldPath = $product->image;

        try {
            $updated = DB::transaction(function () use ($product, $newPath): products {
                $locked = products::query()->lockForUpdate()->findOrFail($product->id);
                $locked->update(['image' => $newPath]);
                return $locked->refresh()->load('category');
            }, 3);
        } catch (\Throwable $exception) {
            $pictures->delete($newPath, 'products');
            throw $exception;
        }

        if ($oldPath !== $newPath) $pictures->delete($oldPath, 'products');
        return response()->json(['data' => (new ProductResource($updated))->resolve($request)]);
    }

    public function destroy(
        DeleteProductRequest $request,
        products $product,
        ApiIdempotencyService $idempotency,
        PictureStorageService $pictures,
    ): JsonResponse {
        $key = $request->validated('idempotency_key');

        return $idempotency->execute(
            $request->user(),
            'products.delete',
            $key,
            ['product_id' => $product->id],
            function () use ($request, $product, $pictures): array {
                $image = $product->image;
                DB::transaction(function () use ($product): void {
                    $locked = products::query()->lockForUpdate()->findOrFail($product->id);
                    if ($this->hasTransactionHistory($locked)) {
                        throw ValidationException::withMessages([
                            'product' => 'لا يمكن حذف منتج له سجل في الفواتير أو الأقساط أو المبيعات.',
                        ]);
                    }
                    $locked->delete();
                }, 3);
                $pictures->delete($image, 'products');

                return ['status' => 204, 'body' => []];
            }
        );
    }

    private function hasTransactionHistory(products $product): bool
    {
        $line = '%"product_id":'.(int) $product->id.',%';

        return $product->invoices()->exists()
            || $product->installments()->exists()
            || $product->sales()->exists()
            || Invoice::query()->where('items', 'like', $line)->exists()
            || Installment::query()->where('items', 'like', $line)->exists();
    }
}
