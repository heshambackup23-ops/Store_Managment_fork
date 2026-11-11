<?php

namespace Tests\Feature;

use App\Models\Maintenance;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1MaintenanceReadTest extends TestCase
{
    use RefreshDatabase;

    public function test_maintenance_records_are_searchable_and_paginated(): void
    {
        $token = $this->tokenWithMaintenanceViewPermission();
        $record = Maintenance::query()->create([
            'name' => 'Phone screen repair',
            'owner' => 'Nour',
            'phone' => '01010000000',
            'address' => 'Cairo',
            'description' => 'Replace screen',
            'notes' => 'Internal note',
            'status' => 'قيد الصيانة',
            'requested_date' => '2026-11-09',
        ]);

        $this->withToken($token)
            ->getJson('/api/v1/maintenance?q=Nour&per_page=1')
            ->assertOk()
            ->assertJsonPath('data.0.id', $record->id)
            ->assertJsonPath('data.0.status', 'قيد الصيانة')
            ->assertJsonMissingPath('data.0.notes')
            ->assertJsonStructure(['data', 'links', 'meta']);
    }

    public function test_maintenance_detail_requires_current_permission_and_token_ability(): void
    {
        $record = Maintenance::query()->create([
            'name' => 'Repair',
            'owner' => 'Owner',
            'phone' => '01010000000',
            'address' => 'Cairo',
            'description' => 'Repair',
            'status' => 'قيد الصيانة',
            'requested_date' => '2026-11-09',
        ]);
        $user = User::factory()->create(['is_active' => true]);
        $overbroadToken = $user->createToken('maintenance-reader', ['api:me', 'page.maintenance.view']);
        $this->withToken($overbroadToken->plainTextToken)
            ->getJson('/api/v1/maintenance/'.$record->id)
            ->assertForbidden();

        $manager = $this->userWithMaintenanceViewPermission();
        $wrongScope = $manager->createToken('wrong-scope', ['api:me']);
        $this->withToken($wrongScope->plainTextToken)
            ->getJson('/api/v1/maintenance/'.$record->id)
            ->assertForbidden();
    }

    private function tokenWithMaintenanceViewPermission(): string
    {
        return $this->userWithMaintenanceViewPermission()
            ->createToken('maintenance-reader', ['api:me', 'page.maintenance.view'])
            ->plainTextToken;
    }

    private function userWithMaintenanceViewPermission(): User
    {
        $permission = Permission::query()->create(['name' => 'page.maintenance.view', 'guard_name' => 'web']);
        $role = Role::query()->create(['name' => 'Maintenance viewer', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user;
    }
}
