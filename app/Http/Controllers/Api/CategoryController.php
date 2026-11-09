<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\CategoryIndexRequest;
use App\Http\Requests\Api\CreateCategoryRequest;
use App\Http\Requests\Api\UpdateCategoryRequest;
use App\Http\Resources\Api\CategoryResource;
use App\Models\category;
use App\Services\ApiIdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

class CategoryController
{
    public function index(CategoryIndexRequest $request): AnonymousResourceCollection
    {
        $filters = $request->validated();
        $query = category::query()->select(['id', 'name']);
        $term = trim((string) ($filters['q'] ?? ''));

        if ($term !== '') {
            $query->where('name', 'like', '%'.addcslashes($term, '%_\\').'%');
        }

        return CategoryResource::collection(
            $query->orderBy('name')->orderBy('id')->paginate($filters['per_page'] ?? 20)
        );
    }

    public function show(category $category): CategoryResource
    {
        return new CategoryResource($category->loadCount('products'));
    }

    public function store(CreateCategoryRequest $request, ApiIdempotencyService $idempotency): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'categories.create',
            $key,
            $data,
            function () use ($request, $data): array {
                $category = category::query()->create($data);

                return [
                    'status' => 201,
                    'body' => ['data' => (new CategoryResource($category))->resolve($request)],
                ];
            }
        );
    }

    public function update(UpdateCategoryRequest $request, category $category): CategoryResource
    {
        $category->update($request->validated());

        return new CategoryResource($category->refresh());
    }

    public function destroy(category $category): JsonResponse
    {
        DB::transaction(function () use ($category): void {
            $category->products()->update(['category_id' => null]);
            $category->delete();
        });

        return response()->json(null, 204);
    }
}
