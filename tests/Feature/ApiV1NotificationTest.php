<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\NotificationRead;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1NotificationTest extends TestCase
{
    use RefreshDatabase;

    public function test_active_notifications_are_paginated_with_user_scoped_read_state(): void
    {
        $token = $this->tokenWithNotificationViewPermission();
        $notification = AppNotification::query()->create([
            'title' => 'تحديث المخزون',
            'message' => 'تم تحديث الكتالوج',
            'is_active' => true,
        ]);
        NotificationRead::query()->create([
            'user_id' => $this->userIdForToken($token),
            'app_notification_id' => $notification->id,
            'read_at' => now(),
        ]);
        AppNotification::query()->create([
            'title' => 'غير نشط',
            'message' => 'لا يظهر',
            'is_active' => false,
        ]);

        $this->withToken($token)
            ->getJson('/api/v1/notifications?per_page=5')
            ->assertOk()
            ->assertJsonPath('data.0.title', 'تحديث المخزون')
            ->assertJsonPath('data.0.is_read', true)
            ->assertJsonCount(1, 'data')
            ->assertJsonStructure(['data', 'links', 'meta']);
    }

    public function test_notification_read_actions_only_update_the_current_user(): void
    {
        $token = $this->tokenWithNotificationViewPermission();
        $notification = AppNotification::query()->create([
            'title' => 'تنبيه',
            'message' => 'رسالة',
            'is_active' => true,
        ]);

        $this->withToken($token)
            ->postJson('/api/v1/notifications/'.$notification->id.'/read')
            ->assertNoContent();

        $userId = $this->userIdForToken($token);
        $this->assertDatabaseHas('notification_reads', [
            'user_id' => $userId,
            'app_notification_id' => $notification->id,
        ]);

        $this->withToken($token)
            ->postJson('/api/v1/notifications/read-all')
            ->assertNoContent();
    }

    private function tokenWithNotificationViewPermission(): string
    {
        $permission = Permission::query()->create(['name' => 'page.notifications.view', 'guard_name' => 'web']);
        $role = Role::query()->create(['name' => 'Notification viewer', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user->createToken('notification-reader', ['api:me', 'page.notifications.view'])->plainTextToken;
    }

    private function userIdForToken(string $plainTextToken): int
    {
        return User::query()->whereHas('tokens', fn ($query) => $query->where('name', 'notification-reader'))->value('id');
    }
}
