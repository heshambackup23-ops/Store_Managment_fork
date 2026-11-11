<?php

namespace Tests\Feature;

use App\Models\invoice;
use App\Models\products;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1CashierTest extends TestCase
{
    use RefreshDatabase;

    public function test_cashier_search_supports_top_sellers_and_exact_barcode_lookup(): void
    {
        $token = $this->cashierToken();
        $product = $this->product('SCAN-123', 5);

        $this->withToken($token)->getJson('/api/v1/cashier/products')
            ->assertOk()
            ->assertJsonPath('data.0.id', $product->id);

        $this->withToken($token)->getJson('/api/v1/cashier/products?q=SCAN-123')
            ->assertOk()
            ->assertJsonPath('exact', true)
            ->assertJsonPath('data.0.barcode', 'SCAN-123');
    }

    public function test_cashier_checkout_uses_server_prices_and_is_safe_to_retry(): void
    {
        $token = $this->cashierToken();
        $product = $this->product('POS-123', 6);
        $key = (string) Str::uuid();
        $payload = [
            'customer' => 'Walk-in customer',
            'items' => [
                ['product_id' => $product->id, 'quantity' => 1],
                ['product_id' => $product->id, 'quantity' => 1],
            ],
            'received' => '150.00',
        ];

        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/cashier/checkout', $payload)
            ->assertCreated()
            ->assertJsonPath('data.total', '200.00')
            ->assertJsonPath('data.paid', '150.00')
            ->assertJsonPath('data.remaining', '50.00');
        $invoiceId = $created->json('data.invoice_id');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/cashier/checkout', $payload)
            ->assertCreated()
            ->assertJsonPath('data.invoice_id', $invoiceId);

        $this->assertSame(4, (int) $product->fresh()->stock);
        $this->assertSame(1, invoice::query()->count());
    }

    public function test_cashier_rejects_partial_payment_without_customer_name(): void
    {
        $token = $this->cashierToken();
        $product = $this->product('POS-456', 3);

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/cashier/checkout', [
                'items' => [['product_id' => $product->id, 'quantity' => 1]],
                'received' => '1.00',
            ])
            ->assertUnprocessable()
            ->assertJsonPath('error_code', 'VALIDATION_FAILED');

        $this->assertSame(0, invoice::query()->count());
        $this->assertSame(3, (int) $product->fresh()->stock);
    }

    private function product(string $barcode, int $stock): products
    {
        return products::query()->create([
            'name' => 'POS product',
            'price' => '100.00',
            'description' => 'POS test product',
            'barcode' => $barcode,
            'stock' => $stock,
        ]);
    }

    private function cashierToken(): string
    {
        $permission = Permission::query()->create(['name' => 'page.invoices.manage', 'guard_name' => 'web']);
        $role = Role::query()->create(['name' => 'POS cashier '.Str::random(8), 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user->createToken('pos-cashier', ['api:me', 'page.invoices.view', 'page.invoices.manage'])->plainTextToken;
    }
}
