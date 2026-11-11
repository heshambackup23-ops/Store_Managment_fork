<?php

namespace Tests\Feature;

use App\Models\customers;
use App\Models\installments;
use App\Models\products;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1InstallmentWriteTest extends TestCase
{
    use RefreshDatabase;

    public function test_installment_create_uses_server_prices_and_replays_idempotently(): void
    {
        $token = $this->tokenWithInstallmentManagePermission();
        $product = $this->product();
        $key = (string) Str::uuid();
        $payload = [
            'customer' => 'Layla Ahmed',
            'product_ids' => [$product->id],
            'quantities' => [2],
            'payment_date' => '2026-11-09',
            'next_payment_date' => '2026-12-09',
            'paid_amount' => '25.00',
        ];

        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/installments', $payload)
            ->assertCreated()
            ->assertJsonPath('data.product_price', '200.00')
            ->assertJsonPath('data.paid_amount', '25.00')
            ->assertJsonPath('data.remaining', '175.00')
            ->assertJsonPath('data.items.0.price', '100.00');
        $installmentId = $created->json('data.id');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/installments', $payload)
            ->assertCreated()
            ->assertJsonPath('data.id', $installmentId);

        $this->assertSame(1, installments::query()->count());
        $this->assertSame(5, $product->fresh()->stock);
        $this->assertSame(1, customers::query()->where('name', 'Layla Ahmed')->count());
    }

    public function test_installment_rejects_overpayment(): void
    {
        $product = $this->product();
        $payload = [
            'customer' => 'Layla Ahmed',
            'product_ids' => [$product->id],
            'quantities' => [1],
            'paid_amount' => '101.00',
        ];
        $managerToken = $this->tokenWithInstallmentManagePermission();

        $this->withToken($managerToken)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/installments', $payload)
            ->assertUnprocessable()
            ->assertJsonPath('error_code', 'VALIDATION_FAILED');

        $this->assertSame(0, installments::query()->count());
        $this->assertSame(5, $product->fresh()->stock);
    }

    public function test_installment_can_be_created_with_a_custom_description_and_total(): void
    {
        $token = $this->tokenWithInstallmentManagePermission();

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/installments', [
                'customer' => 'Layla Ahmed',
                'product_name' => 'Custom repair service',
                'total_amount' => '350.00',
                'paid_amount' => '100.00',
            ])
            ->assertCreated()
            ->assertJsonPath('data.product_id', null)
            ->assertJsonPath('data.product_name', 'Custom repair service')
            ->assertJsonPath('data.product_price', '350.00')
            ->assertJsonPath('data.paid_amount', '100.00')
            ->assertJsonPath('data.remaining', '250.00')
            ->assertJsonPath('data.items.0.product_id', null);

        $this->assertDatabaseCount('installments', 1);
    }

    public function test_custom_installment_can_be_edited_and_paid_in_parts_or_in_full(): void
    {
        $token = $this->tokenWithInstallmentManagePermission();
        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/installments', [
                'customer' => 'Layla Ahmed',
                'product_name' => 'Repair service',
                'total_amount' => '350.00',
                'paid_amount' => '50.00',
            ])
            ->assertCreated();
        $id = $created->json('data.id');

        $updated = $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->putJson('/api/v1/installments/'.$id, [
                'customer' => 'Layla Ahmed',
                'product_name' => 'Updated repair service',
                'total_amount' => '400.00',
                'paid_amount' => '50.00',
            ])
            ->assertOk()
            ->assertJsonPath('data.product_name', 'Updated repair service')
            ->assertJsonPath('data.remaining', '350.00');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/installments/'.$id.'/pay', ['amount' => '100.00'])
            ->assertOk()
            ->assertJsonPath('data.paid_amount', '150.00')
            ->assertJsonPath('data.remaining', '250.00');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/installments/'.$id.'/pay', [])
            ->assertOk()
            ->assertJsonPath('data.paid_amount', '400.00')
            ->assertJsonPath('data.remaining', '0.00')
            ->assertJsonPath('data.status', 'مكتمل');
    }

    public function test_view_only_users_cannot_create_installments(): void
    {
        $product = $this->product();
        $viewPermission = Permission::query()->create([
            'name' => 'page.installments.view',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Installment viewer', 'guard_name' => 'web']);
        $role->givePermissionTo($viewPermission);
        $viewer = User::factory()->create(['is_active' => true]);
        $viewer->assignRole($role);
        $viewToken = $viewer->createToken('installment-viewer', ['api:me', 'page.installments.view']);

        $this->withToken($viewToken->plainTextToken)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/installments', [
                'customer' => 'Layla Ahmed',
                'product_ids' => [$product->id],
                'quantities' => [1],
                'paid_amount' => '0.00',
            ])
            ->assertForbidden();

        $this->assertSame(0, installments::query()->count());
        $this->assertSame(5, $product->fresh()->stock);
    }

    private function product(): products
    {
        return products::query()->create([
            'name' => 'Phone A',
            'price' => '100.00',
            'description' => 'Phone',
            'stock' => 5,
        ]);
    }

    private function tokenWithInstallmentManagePermission(): string
    {
        $permission = Permission::query()->create([
            'name' => 'page.installments.manage',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Installment manager', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user->createToken('installment-manager', [
            'api:me',
            'page.installments.view',
            'page.installments.manage',
        ])->plainTextToken;
    }
}
