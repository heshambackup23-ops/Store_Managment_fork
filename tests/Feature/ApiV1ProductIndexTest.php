<?php

namespace Tests\Feature;

use App\Models\category;
use App\Models\products;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1ProductIndexTest extends TestCase
{
    use RefreshDatabase;

    public function test_product_list_is_paginated_filtered_and_serialized_through_a_resource(): void
    {
        $user = $this->userWithProductViewPermission();
        $token = $user->createToken('catalog-reader', ['api:me', 'page.products.view']);
        $category = category::query()->create(['name' => 'Phones']);
        $matching = products::query()->create([
            'name' => 'Phone Model A',
            'price' => '125.50',
            'description' => 'Phone description',
            'barcode' => 'PHONE-A',
            'stock' => 3,
            'category_id' => $category->id,
        ]);
        products::query()->create([
            'name' => 'Phone Model B',
            'price' => '90.00',
            'description' => 'Out of stock phone',
            'barcode' => 'PHONE-B',
            'stock' => 0,
            'category_id' => $category->id,
        ]);

        $this->withToken($token->plainTextToken)
            ->getJson('/api/v1/products?q=PHONE-A&category_id='.$category->id.'&in_stock=true&per_page=1')
            ->assertOk()
            ->assertJsonPath('data.0.id', $matching->id)
            ->assertJsonPath('data.0.price', '125.50')
            ->assertJsonPath('data.0.stock', 3)
            ->assertJsonPath('data.0.category.name', 'Phones')
            ->assertJsonStructure(['data', 'links', 'meta']);
    }

    public function test_product_list_requires_both_user_permission_and_token_ability(): void
    {
        $user = $this->userWithProductViewPermission();
        $token = $user->createToken('wrong-scope', ['api:me']);

        $this->withToken($token->plainTextToken)
            ->getJson('/api/v1/products')
            ->assertForbidden();

        $userWithoutPermission = User::factory()->create(['is_active' => true]);
        $tokenWithoutPermission = $userWithoutPermission->createToken('overbroad-scope', [
            'api:me',
            'page.products.view',
        ]);

        $this->withToken($tokenWithoutPermission->plainTextToken)
            ->getJson('/api/v1/products')
            ->assertForbidden();
    }

    public function test_product_filters_reject_invalid_pagination_and_category_values(): void
    {
        $user = $this->userWithProductViewPermission();
        $token = $user->createToken('catalog-reader', ['api:me', 'page.products.view']);

        $this->withToken($token->plainTextToken)
            ->getJson('/api/v1/products?per_page=101&category_id=999')
            ->assertUnprocessable()
            ->assertJsonPath('error_code', 'VALIDATION_FAILED')
            ->assertJsonStructure(['errors' => ['per_page', 'category_id']]);
    }

    public function test_false_in_stock_filter_returns_only_out_of_stock_products(): void
    {
        $user = $this->userWithProductViewPermission();
        $token = $user->createToken('catalog-reader', ['api:me', 'page.products.view']);
        $outOfStock = products::query()->create([
            'name' => 'Out of stock phone',
            'price' => '100.00',
            'description' => 'No stock',
            'stock' => 0,
        ]);
        products::query()->create([
            'name' => 'Available phone',
            'price' => '100.00',
            'description' => 'Available',
            'stock' => 2,
        ]);

        $this->withToken($token->plainTextToken)
            ->getJson('/api/v1/products?in_stock=false')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $outOfStock->id);
    }

    public function test_product_create_is_idempotent_and_requires_manage_permission(): void
    {
        $user = User::factory()->create(['is_active' => true]);
        $permission = Permission::query()->create([
            'name' => 'page.products.manage',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Catalog manager', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user->assignRole($role);
        $token = $user->createToken('catalog-manager', [
            'api:me',
            'page.products.view',
            'page.products.manage',
        ]);
        $key = (string) Str::uuid();
        $payload = [
            'name' => 'New phone',
            'price' => '199.50',
            'description' => null,
            'barcode' => null,
            'stock' => 8,
        ];

        $created = $this->withToken($token->plainTextToken)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/products', $payload)
            ->assertCreated()
            ->assertJsonPath('data.name', 'New phone')
            ->assertJsonPath('data.price', '199.50');

        $this->withToken($token->plainTextToken)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/products', $payload)
            ->assertCreated()
            ->assertJsonPath('data.id', $created->json('data.id'));

        $this->assertSame(1, products::query()->count());
    }

    public function test_product_manager_can_update_and_delete_only_products_without_history(): void
    {
        $user = User::factory()->create(['is_active' => true]);
        $permission = Permission::query()->create(['name' => 'page.products.manage', 'guard_name' => 'web']);
        $role = Role::query()->create(['name' => 'Catalog editor', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user->assignRole($role);
        $token = $user->createToken('catalog-editor', ['api:me', 'page.products.view', 'page.products.manage'])->plainTextToken;
        $product = products::query()->create([
            'name' => 'Editable product', 'price' => '25.00', 'description' => null, 'stock' => 10,
        ]);
        $updateKey = (string) Str::uuid();
        $updatePayload = [
            'name' => 'Updated product', 'price' => '30.00', 'description' => null,
            'barcode' => 'EDIT-001', 'stock' => 8, 'category_id' => null,
        ];

        $updated = $this->withToken($token)
            ->withHeader('Idempotency-Key', $updateKey)
            ->putJson('/api/v1/products/'.$product->id, $updatePayload)
            ->assertOk()
            ->assertJsonPath('data.name', 'Updated product')
            ->assertJsonPath('data.barcode', 'EDIT-001');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', $updateKey)
            ->putJson('/api/v1/products/'.$product->id, $updatePayload)
            ->assertOk()
            ->assertJsonPath('data.id', $updated->json('data.id'));

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->deleteJson('/api/v1/products/'.$product->id)
            ->assertNoContent();

        $this->assertDatabaseMissing('products', ['id' => $product->id]);
    }

    private function userWithProductViewPermission(): User
    {
        $permission = Permission::query()->create([
            'name' => 'page.products.view',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Catalog viewer', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user;
    }
}
