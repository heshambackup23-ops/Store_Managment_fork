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

class ApiV1CategoryWriteTest extends TestCase
{
    use RefreshDatabase;

    public function test_category_create_is_idempotent_and_update_delete_detaches_products(): void
    {
        $token = $this->tokenWithCategoryManagePermission();
        $key = (string) Str::uuid();
        $payload = ['name' => 'Phones'];

        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/categories', $payload)
            ->assertCreated()
            ->assertJsonPath('data.name', 'Phones');
        $categoryId = $created->json('data.id');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/categories', $payload)
            ->assertCreated()
            ->assertJsonPath('data.id', $categoryId);
        $this->assertSame(1, category::query()->count());

        $product = products::query()->create([
            'name' => 'Phone',
            'price' => '100.00',
            'description' => 'Phone',
            'stock' => 3,
            'category_id' => $categoryId,
        ]);

        $this->withToken($token)
            ->putJson('/api/v1/categories/'.$categoryId, ['name' => 'Mobile phones'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Mobile phones');

        $this->withToken($token)
            ->deleteJson('/api/v1/categories/'.$categoryId)
            ->assertNoContent();
        $this->assertDatabaseMissing('categories', ['id' => $categoryId]);
        $this->assertNull($product->fresh()->category_id);
    }

    public function test_view_only_token_cannot_mutate_categories(): void
    {
        $permission = Permission::query()->create([
            'name' => 'page.categories.view',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Category viewer', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);
        $token = $user->createToken('category-viewer', ['api:me', 'page.categories.view']);

        $this->withToken($token->plainTextToken)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/categories', ['name' => 'Forbidden'])
            ->assertForbidden();
        $this->assertDatabaseMissing('categories', ['name' => 'Forbidden']);
    }

    private function tokenWithCategoryManagePermission(): string
    {
        $permission = Permission::query()->create([
            'name' => 'page.categories.manage',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Category manager', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user->createToken('category-manager', [
            'api:me',
            'page.categories.view',
            'page.categories.manage',
        ])->plainTextToken;
    }
}
