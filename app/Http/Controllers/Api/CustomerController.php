<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\CreateCustomerRequest;
use App\Http\Requests\Api\CustomerIndexRequest;
use App\Http\Requests\Api\UpdateCustomerRequest;
use App\Http\Resources\Api\CustomerResource;
use App\Models\customers;
use App\Services\ApiIdempotencyService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class CustomerController
{
    public function index(CustomerIndexRequest $request): AnonymousResourceCollection
    {
        $filters = $request->validated();
        $query = customers::query()->select(['id', 'name', 'phone', 'address']);
        $term = trim((string) ($filters['q'] ?? ''));

        if ($term !== '') {
            $search = '%'.addcslashes($term, '%_\\').'%';
            $query->where(fn ($query) => $query
                ->where('name', 'like', $search)
                ->orWhere('phone', 'like', $search));
        }

        return CustomerResource::collection(
            $query->orderByDesc('id')->paginate($filters['per_page'] ?? 20)
        );
    }

    public function show(customers $customer): CustomerResource
    {
        return new CustomerResource($customer);
    }

    public function store(CreateCustomerRequest $request, ApiIdempotencyService $idempotency): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'customers.create',
            $key,
            $data,
            function () use ($request, $data): array {
                $customer = customers::query()->create($data);

                return [
                    'status' => 201,
                    'body' => ['data' => (new CustomerResource($customer))->resolve($request)],
                ];
            }
        );
    }

    public function update(UpdateCustomerRequest $request, customers $customer): CustomerResource
    {
        $customer->update($request->validated());

        return new CustomerResource($customer->refresh());
    }

    public function destroy(customers $customer): JsonResponse
    {
        $customer->delete();

        return response()->json(null, 204);
    }
}
