<?php

namespace Tests\Feature;

use App\Models\products;
use App\Models\User;
use App\Models\invoice;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1InvoiceCreationTest extends TestCase
{
    use RefreshDatabase;

    public function test_invoice_creation_uses_server_prices_and_updates_stock_once(): void
    {
        [$user, $token] = $this->invoiceManager();
        $product = $this->product(stock: 5);
        $payload = $this->payload($product->id);
        $key = (string) Str::uuid();

        $first = $this->createInvoice($token, $key, $payload)
            ->assertCreated()
            ->assertJsonPath('data.total_amount', '200.00')
            ->assertJsonPath('data.paid_amount', '50.00')
            ->assertJsonPath('data.remaining_amount', '150.00');

        $invoiceId = $first->json('data.id');
        $this->assertSame(3, (int) $product->fresh()->stock);
        $this->assertSame(1, invoice::query()->count());

        $this->createInvoice($token, $key, $payload)
            ->assertCreated()
            ->assertJsonPath('data.id', $invoiceId);

        $this->assertSame(3, (int) $product->fresh()->stock);
        $this->assertSame(1, invoice::query()->count());
        $this->assertDatabaseHas('api_idempotency_records', [
            'user_id' => $user->id,
            'operation' => 'invoices.create',
            'idempotency_key' => $key,
            'response_status' => 201,
        ]);
    }

    public function test_reusing_an_idempotency_key_with_a_different_payload_is_rejected(): void
    {
        [$user, $token] = $this->invoiceManager();
        $product = $this->product(stock: 5);
        $key = (string) Str::uuid();

        $this->createInvoice($token, $key, $this->payload($product->id))->assertCreated();

        $changedPayload = $this->payload($product->id);
        $changedPayload['paid_amount'] = '100.00';

        $this->createInvoice($token, $key, $changedPayload)
            ->assertConflict()
            ->assertJsonPath('error_code', 'IDEMPOTENCY_KEY_REUSED');

        $this->assertSame(1, invoice::query()->count());
        $this->assertSame(3, (int) $product->fresh()->stock);
        $this->assertSame(1, $user->tokens()->count());
    }

    public function test_view_only_token_cannot_create_an_invoice(): void
    {
        $viewer = User::factory()->create(['is_active' => true]);
        $viewerToken = $viewer->createToken('invoice-viewer', ['api:me', 'page.invoices.view']);
        $product = $this->product(stock: 5);

        $this->createInvoice($viewerToken->plainTextToken, (string) Str::uuid(), $this->payload($product->id))
            ->assertForbidden();
        $this->assertSame(0, invoice::query()->count());
    }

    public function test_invoice_creation_requires_an_idempotency_key(): void
    {
        [$manager, $managerToken] = $this->invoiceManager();
        $product = $this->product(stock: 5);

        $this->withToken($managerToken)
            ->postJson('/api/v1/invoices', $this->payload($product->id))
            ->assertUnprocessable()
            ->assertJsonPath('error_code', 'VALIDATION_FAILED')
            ->assertJsonStructure(['errors' => ['idempotency_key']]);

        $this->assertSame(0, invoice::query()->count());
        $this->assertSame(1, $manager->tokens()->count());
    }

    public function test_failed_stock_validation_rolls_back_invoice_and_idempotency_record(): void
    {
        [, $token] = $this->invoiceManager();
        $product = $this->product(stock: 1);
        $payload = $this->payload($product->id);
        $payload['quantities'] = [2];

        $this->createInvoice($token, (string) Str::uuid(), $payload)
            ->assertUnprocessable()
            ->assertJsonPath('error_code', 'VALIDATION_FAILED');

        $this->assertSame(0, invoice::query()->count());
        $this->assertSame(1, (int) $product->fresh()->stock);
        $this->assertDatabaseCount('api_idempotency_records', 0);
    }

    private function invoiceManager(): array
    {
        $permission = Permission::query()->create([
            'name' => 'page.invoices.manage',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Invoice manager '.Str::random(8), 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);
        $token = $user->createToken('invoice-manager', ['api:me', 'page.invoices.view', 'page.invoices.manage']);

        return [$user, $token->plainTextToken];
    }

    private function product(int $stock): products
    {
        return products::query()->create([
            'name' => 'API Phone',
            'price' => '100.00',
            'description' => 'Test product',
            'stock' => $stock,
        ]);
    }

    private function payload(int $productId): array
    {
        return [
            'customer' => 'API Customer',
            'product_ids' => [$productId],
            'quantities' => [2],
            'invoice_date' => '2026-11-09',
            'paid_amount' => '50.00',
        ];
    }

    private function createInvoice(string $token, string $key, array $payload)
    {
        return $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/invoices', $payload);
    }
}
