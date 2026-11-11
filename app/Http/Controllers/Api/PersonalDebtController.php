<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\CreatePersonalDebtRequest;
use App\Http\Requests\Api\DeletePersonalDebtRequest;
use App\Http\Requests\Api\PayPersonalDebtRequest;
use App\Http\Requests\Api\UpdatePersonalDebtRequest;
use App\Http\Resources\Api\PersonalDebtResource;
use App\Models\PersonalDebt;
use App\Services\ApiIdempotencyService;
use App\Services\PersonalDebtService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class PersonalDebtController
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $term = trim((string) $request->query('q', ''));
        $query = PersonalDebt::query()->with('payments')->orderByDesc('id');
        if ($term !== '') {
            $search = '%'.addcslashes($term, '%_\\').'%';
            $query->where(fn ($builder) => $builder
                ->where('creditor', 'like', $search)
                ->orWhere('description', 'like', $search));
        }

        return PersonalDebtResource::collection($query->paginate(20));
    }

    public function show(PersonalDebt $debt): PersonalDebtResource
    {
        return new PersonalDebtResource($debt->load('payments'));
    }

    public function store(CreatePersonalDebtRequest $request, ApiIdempotencyService $idempotency, PersonalDebtService $service): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(), 'personal-debts.create', $key, $data,
            function () use ($request, $data, $service): array {
                $debt = $service->create($data, $request->user())->load('payments');
                return ['status' => 201, 'body' => ['data' => (new PersonalDebtResource($debt))->resolve($request)]];
            }
        );
    }

    public function update(UpdatePersonalDebtRequest $request, PersonalDebt $debt, ApiIdempotencyService $idempotency, PersonalDebtService $service): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(), 'personal-debts.update', $key, ['debt_id' => $debt->id] + $data,
            function () use ($request, $debt, $data, $service): array {
                $updated = $service->update($debt, $data)->load('payments');
                return ['status' => 200, 'body' => ['data' => (new PersonalDebtResource($updated))->resolve($request)]];
            }
        );
    }

    public function pay(PayPersonalDebtRequest $request, PersonalDebt $debt, ApiIdempotencyService $idempotency, PersonalDebtService $service): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(), 'personal-debts.pay', $key, ['debt_id' => $debt->id] + $data,
            function () use ($request, $debt, $data, $service): array {
                $updated = $service->pay($debt, $data['amount'], $data['notes'] ?? null, $request->user())->load('payments');
                return ['status' => 200, 'body' => ['data' => (new PersonalDebtResource($updated))->resolve($request)]];
            }
        );
    }

    public function destroy(DeletePersonalDebtRequest $request, PersonalDebt $debt, ApiIdempotencyService $idempotency, PersonalDebtService $service): JsonResponse
    {
        $key = $request->validated('idempotency_key');

        return $idempotency->execute(
            $request->user(), 'personal-debts.delete', $key, ['debt_id' => $debt->id],
            function () use ($debt, $service): array {
                $service->delete($debt);
                return ['status' => 204, 'body' => []];
            }
        );
    }
}
