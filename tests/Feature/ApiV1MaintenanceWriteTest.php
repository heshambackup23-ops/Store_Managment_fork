<?php

namespace Tests\Feature;

use App\Models\Maintenance;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1MaintenanceWriteTest extends TestCase
{
    use RefreshDatabase;

    public function test_maintenance_manager_can_create_update_and_delete_with_nullable_fields(): void
    {
        $token = $this->managerToken();
        $key = (string) Str::uuid();
        $payload = [
            'name' => 'Phone repair',
            'owner' => 'Nour',
            'phone' => null,
            'address' => null,
            'description' => null,
            'status' => 'قيد الصيانة',
            'requested_date' => '2026-11-09',
        ];

        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/maintenance', $payload)
            ->assertCreated()
            ->assertJsonPath('data.phone', null)
            ->assertJsonPath('data.address', null)
            ->assertJsonPath('data.description', null);
        $id = $created->json('data.id');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/maintenance', $payload)
            ->assertCreated()
            ->assertJsonPath('data.id', $id);

        $this->withToken($token)
            ->putJson('/api/v1/maintenance/'.$id, array_replace($payload, ['owner' => 'Layla']))
            ->assertOk()
            ->assertJsonPath('data.owner', 'Layla');

        $this->withToken($token)
            ->deleteJson('/api/v1/maintenance/'.$id)
            ->assertNoContent();

        $this->assertDatabaseMissing('maintenances', ['id' => $id]);
        $this->assertSame(0, Maintenance::query()->count());
    }

    public function test_maintenance_write_requires_manage_permission_and_ability(): void
    {
        $permission = Permission::query()->create(['name' => 'page.maintenance.view', 'guard_name' => 'web']);
        $role = Role::query()->create(['name' => 'Maintenance viewer only', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);
        $token = $user->createToken('maintenance-viewer', ['api:me', 'page.maintenance.view']);

        $this->withToken($token->plainTextToken)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/maintenance', [
                'name' => 'Forbidden',
                'owner' => 'Owner',
                'status' => 'قيد الصيانة',
                'requested_date' => '2026-11-09',
            ])
            ->assertForbidden();
    }

    private function managerToken(): string
    {
        $permission = Permission::query()->create(['name' => 'page.maintenance.manage', 'guard_name' => 'web']);
        $role = Role::query()->create(['name' => 'Maintenance manager', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user->createToken('maintenance-manager', [
            'api:me', 'page.maintenance.view', 'page.maintenance.manage',
        ])->plainTextToken;
    }
}
