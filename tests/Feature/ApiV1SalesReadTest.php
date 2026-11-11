<?php

namespace Tests\Feature;

use App\Models\products;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1SalesReadTest extends TestCase
{
    use RefreshDatabase;

    public function test_sales_report_uses_product_sold_totals_and_is_searchable(): void
    {
        $token = $this->tokenWithSalesViewPermission();
        $phone = products::query()->create([
            'name' => 'Phone A',
            'price' => '100.00',
            'description' => 'Phone',
            'stock' => 2,
        ]);
        $phone->forceFill(['total_sold' => 7])->save();
        $case = products::query()->create([
            'name' => 'Case B',
            'price' => '10.00',
            'description' => 'Case',
            'stock' => 1,
        ]);
        $case->forceFill(['total_sold' => 3])->save();

        $this->withToken($token)
            ->getJson('/api/v1/sales?q=Phone')
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Phone A')
            ->assertJsonPath('data.0.sold_quantity', 7)
            ->assertJsonStructure(['data', 'links', 'meta']);
    }

    public function test_sales_report_requires_permission_and_token_ability(): void
    {
        $user = User::factory()->create(['is_active' => true]);
        $overbroadToken = $user->createToken('sales-viewer', ['api:me', 'page.sales.view']);
        $this->withToken($overbroadToken->plainTextToken)->getJson('/api/v1/sales')->assertForbidden();

        $manager = $this->userWithSalesViewPermission();
        $wrongScope = $manager->createToken('wrong-sales-scope', ['api:me']);
        $this->withToken($wrongScope->plainTextToken)->getJson('/api/v1/sales')->assertForbidden();
    }

    private function tokenWithSalesViewPermission(): string
    {
        return $this->userWithSalesViewPermission()
            ->createToken('sales-viewer', ['api:me', 'page.sales.view'])
            ->plainTextToken;
    }

    private function userWithSalesViewPermission(): User
    {
        $permission = Permission::query()->create(['name' => 'page.sales.view', 'guard_name' => 'web']);
        $role = Role::query()->create(['name' => 'Sales viewer', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user;
    }
}
