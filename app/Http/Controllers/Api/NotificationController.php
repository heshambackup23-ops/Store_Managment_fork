<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\Api\NotificationResource;
use App\Models\AppNotification;
use App\Models\NotificationRead;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class NotificationController
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $validated = $request->validate([
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $notifications = AppNotification::query()
            ->active()
            ->select(['id', 'title', 'message', 'starts_at', 'ends_at', 'created_at'])
            ->latest('id')
            ->paginate($validated['per_page'] ?? 20);
        $readIds = NotificationRead::query()
            ->where('user_id', $request->user()->id)
            ->whereIn('app_notification_id', $notifications->getCollection()->pluck('id'))
            ->pluck('app_notification_id')
            ->flip();

        $notifications->getCollection()->each(function (AppNotification $notification) use ($readIds): void {
            $notification->setAttribute('is_read', $readIds->has($notification->id));
        });

        return NotificationResource::collection($notifications);
    }

    public function read(Request $request, int $notification): JsonResponse
    {
        $activeNotification = AppNotification::query()->active()->findOrFail($notification);
        NotificationRead::query()->updateOrCreate(
            ['user_id' => $request->user()->id, 'app_notification_id' => $activeNotification->id],
            ['read_at' => now()],
        );

        return response()->json(null, 204);
    }

    public function readAll(Request $request): JsonResponse
    {
        $timestamp = now();
        $rows = AppNotification::query()->active()->pluck('id')->map(fn ($id): array => [
            'user_id' => $request->user()->id,
            'app_notification_id' => $id,
            'read_at' => $timestamp,
            'created_at' => $timestamp,
            'updated_at' => $timestamp,
        ])->all();

        if ($rows !== []) {
            NotificationRead::query()->upsert(
                $rows,
                ['user_id', 'app_notification_id'],
                ['read_at', 'updated_at'],
            );
        }

        return response()->json(null, 204);
    }
}
