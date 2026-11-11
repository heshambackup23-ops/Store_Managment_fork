<?php

namespace Tests\Feature;

use App\Models\DamagedItem;
use App\Models\products;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1DamagedItemTest extends TestCase
{
    use RefreshDatabase;

    public function test_damaged_record_reduces_stock_and_void_restores_it_without_deleting_history(): void
    {
        $token = $this->managerToken();
        $product = products::query()->create([
            'name' => 'Broken device', 'price' => '100.00', 'description' => 'Test', 'stock' => 5,
        ]);
        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/damaged', [
                'product_id' => $product->id,
                'quantity' => 2,
                'reason' => 'broken',
                'damaged_on' => '2026-11-09',
                'notes' => null,
            ])
            ->assertCreated()
            ->assertJsonPath('data.quantity', 2)
            ->assertJsonPath('data.status', 'recorded');
        $itemId = $created->json('data.id');
        $this->assertSame(3, (int) $product->fresh()->stock);

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/damaged/'.$itemId.'/void', ['reason' => 'Wrong entry'])
            ->assertOk()
            ->assertJsonPath('data.status', 'voided');

        $this->assertSame(5, (int) $product->fresh()->stock);
        $this->assertSame(1, DamagedItem::query()->count());
    }

    public function test_damaged_record_can_be_corrected_and_stock_follows_the_new_quantity(): void
    {
        $token = $this->managerToken();
        $product = products::query()->create([
            'name' => 'Cracked screen', 'price' => '50.00', 'description' => 'Test', 'stock' => 10,
        ]);
        $itemId = $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/damaged', [
                'product_id' => $product->id,
                'quantity' => 2,
                'reason' => 'broken',
                'damaged_on' => '2026-11-09',
            ])
            ->assertCreated()
            ->json('data.id');
        $this->assertSame(8, (int) $product->fresh()->stock);

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->putJson('/api/v1/damaged/'.$itemId, [
                'quantity' => 5,
                'reason' => 'water',
                'unit_value' => '40.00',
                'damaged_on' => '2026-11-09',
                'notes' => 'Counted again',
            ])
            ->assertOk()
            ->assertJsonPath('data.quantity', 5)
            ->assertJsonPath('data.reason', 'water')
            ->assertJsonPath('data.total_value', '200.00')
            ->assertJsonPath('data.stock_after', 5);
        $this->assertSame(5, (int) $product->fresh()->stock);

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->putJson('/api/v1/damaged/'.$itemId, [
                'quantity' => 1,
                'reason' => 'water',
                'damaged_on' => '2026-11-09',
            ])
            ->assertOk();
        $this->assertSame(9, (int) $product->fresh()->stock);

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->putJson('/api/v1/damaged/'.$itemId, [
                'quantity' => 500,
                'reason' => 'water',
                'damaged_on' => '2026-11-09',
            ])
            ->assertStatus(422);
        $this->assertSame(9, (int) $product->fresh()->stock);
    }

    private function managerToken(): string
    {
        $permission = Permission::query()->create(['name' => 'page.damaged.manage', 'guard_name' => 'web']);
        $role = Role::query()->create(['name' => 'Damaged manager', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user->createToken('damaged-manager', ['api:me', 'page.damaged.view', 'page.damaged.manage'])->plainTextToken;
    }
}
