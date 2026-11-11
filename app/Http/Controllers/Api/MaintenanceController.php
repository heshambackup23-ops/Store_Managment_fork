<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\MaintenanceIndexRequest;
use App\Http\Requests\Api\CreateMaintenanceRequest;
use App\Http\Requests\Api\UpdateMaintenanceRequest;
use App\Http\Resources\Api\MaintenanceResource;
use App\Models\Maintenance;
use App\Services\ApiIdempotencyService;
use App\Services\PictureStorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

class MaintenanceController
{
    public function index(MaintenanceIndexRequest $request): AnonymousResourceCollection
    {
        $filters = $request->validated();
        $term = trim((string) ($filters['q'] ?? ''));
        $query = Maintenance::query()->select([
            'id', 'name', 'owner', 'phone', 'address', 'description', 'status', 'requested_date', 'completed_date',
        ]);

        if ($term !== '') {
            $search = '%'.addcslashes($term, '%_\\').'%';
            $query->where(fn ($query) => $query
                ->where('name', 'like', $search)
                ->orWhere('owner', 'like', $search)
                ->orWhere('phone', 'like', $search));
        }

        return MaintenanceResource::collection(
            $query->orderByDesc('id')->paginate($filters['per_page'] ?? 20)
        );
    }

    public function show(Maintenance $maintenance): MaintenanceResource
    {
        return new MaintenanceResource($maintenance);
    }

    public function store(CreateMaintenanceRequest $request, ApiIdempotencyService $idempotency): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'maintenance.create',
            $key,
            $data,
            function () use ($request, $data): array {
                $maintenance = DB::transaction(fn () => Maintenance::query()->create([
                    ...$data,
                    'completed_date' => $data['status'] === 'مكتمل' ? now()->toDateString() : null,
                ]));

                return [
                    'status' => 201,
                    'body' => ['data' => (new MaintenanceResource($maintenance))->resolve($request)],
                ];
            }
        );
    }

    public function update(UpdateMaintenanceRequest $request, Maintenance $maintenance): MaintenanceResource
    {
        $data = $request->validated();
        $data['completed_date'] = $data['status'] === 'مكتمل'
            ? ($maintenance->completed_date?->toDateString() ?? now()->toDateString())
            : null;
        $maintenance->update($data);

        return new MaintenanceResource($maintenance->refresh());
    }

    public function destroy(Maintenance $maintenance, PictureStorageService $pictures): JsonResponse
    {
        $imagePath = $maintenance->image_path;
        $maintenance->delete();
        $pictures->delete($imagePath, 'maintenance');

        return response()->json(null, 204);
    }
}
