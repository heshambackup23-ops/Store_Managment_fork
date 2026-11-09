<?php

namespace Tests\Feature;

use App\Models\category;
use App\Models\customers;
use App\Models\invoice;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1ReadEndpointsTest extends TestCase
{
    use RefreshDatabase;

    public function test_categories_are_searchable_and_paginated_for_authorized_users(): void
    {
        $token = $this->tokenWithPermissions(['page.categories.view']);
        category::query()->create(['name' => 'Accessories']);
        $category = category::query()->create(['name' => 'Phones']);

        $this->withToken($token)
            ->getJson('/api/v1/categories?q=Phone&per_page=1')
            ->assertOk()
            ->assertJsonPath('data.0.id', $category->id)
            ->assertJsonPath('data.0.name', 'Phones')
            ->assertJsonStructure(['data', 'links', 'meta']);
    }

    public function test_customers_are_searchable_without_exposing_installment_balances(): void
    {
        $token = $this->tokenWithPermissions(['page.customers.view']);
        $customer = customers::query()->create([
            'name' => 'Sam Customer',
            'phone' => '01012345678',
            'address' => 'Cairo',
        ]);

        $this->withToken($token)
            ->getJson('/api/v1/customers?q=010123')
            ->assertOk()
            ->assertJsonPath('data.0.id', $customer->id)
            ->assertJsonPath('data.0.name', 'Sam Customer')
            ->assertJsonMissingPath('data.0.installment_due')
            ->assertJsonStructure(['data', 'links', 'meta']);
    }

    public function test_invoices_return_snapshotted_items_and_server_recorded_totals(): void
    {
        $token = $this->tokenWithPermissions(['page.invoices.view']);
        $product = \App\Models\products::query()->create([
            'name' => 'Phone',
            'price' => '100.00',
            'description' => 'Phone description',
            'stock' => 5,
        ]);
        $invoice = invoice::query()->create([
            'invoice_number' => 'INV-API-001',
            'customer' => 'Sam Customer',
            'product_id' => $product->id,
            'invoice_date' => '2026-11-09',
            'quantity' => 2,
            'status' => 'unpaid',
            'total_amount' => '200.00',
            'product_price' => '100.00',
            'paid_amount' => '50.00',
            'items' => [['product_id' => $product->id, 'name' => 'Phone', 'price' => '100.00', 'quantity' => 2]],
            'notes' => null,
        ]);

        $this->withToken($token)
            ->getJson('/api/v1/invoices?q=INV-API&per_page=5')
            ->assertOk()
            ->assertJsonPath('data.0.id', $invoice->id)
            ->assertJsonPath('data.0.invoice_number', 'INV-API-001')
            ->assertJsonPath('data.0.total_amount', '200.00')
            ->assertJsonPath('data.0.paid_amount', '50.00')
            ->assertJsonPath('data.0.remaining_amount', '150.00')
            ->assertJsonPath('data.0.items.0.product_id', $product->id)
            ->assertJsonStructure(['data', 'links', 'meta']);
    }

    public function test_each_read_endpoint_requires_its_matching_permission_and_token_ability(): void
    {
        $token = $this->tokenWithPermissions(['page.categories.view']);

        $this->withToken($token)->getJson('/api/v1/customers')->assertForbidden();
        $this->withToken($token)->getJson('/api/v1/invoices')->assertForbidden();
    }

    public function test_record_detail_endpoints_return_explicit_resources(): void
    {
        $token = $this->tokenWithPermissions([
            'page.products.view',
            'page.categories.view',
            'page.customers.view',
            'page.invoices.view',
        ]);
        $category = category::query()->create(['name' => 'Phones']);
        $product = \App\Models\products::query()->create([
            'name' => 'Phone Model',
            'price' => '100.00',
            'description' => 'Product details',
            'stock' => 4,
            'category_id' => $category->id,
        ]);
        $customer = customers::query()->create([
            'name' => 'Sam Customer',
            'phone' => '01012345678',
            'address' => 'Cairo',
        ]);
        $invoice = invoice::query()->create([
            'invoice_number' => 'INV-DETAIL-001',
            'customer' => $customer->name,
            'product_id' => $product->id,
            'invoice_date' => '2026-11-09',
            'quantity' => 1,
            'status' => 'paid',
            'total_amount' => '100.00',
            'product_price' => '100.00',
            'paid_amount' => '100.00',
            'items' => [['product_id' => $product->id, 'name' => $product->name, 'price' => '100.00', 'quantity' => 1]],
        ]);

        $this->withToken($token)->getJson('/api/v1/products/'.$product->id)
            ->assertOk()
            ->assertJsonPath('data.id', $product->id)
            ->assertJsonPath('data.category.name', 'Phones');
        $this->withToken($token)->getJson('/api/v1/categories/'.$category->id)
            ->assertOk()
            ->assertJsonPath('data.products_count', 1);
        $this->withToken($token)->getJson('/api/v1/customers/'.$customer->id)
            ->assertOk()
            ->assertJsonPath('data.name', 'Sam Customer');
        $this->withToken($token)->getJson('/api/v1/invoices/'.$invoice->id)
            ->assertOk()
            ->assertJsonPath('data.invoice_number', 'INV-DETAIL-001')
            ->assertJsonPath('data.items.0.product_id', $product->id);
    }

    public function test_missing_record_details_return_a_stable_not_found_error(): void
    {
        $token = $this->tokenWithPermissions(['page.products.view']);

        $this->withToken($token)
            ->getJson('/api/v1/products/999999')
            ->assertNotFound()
            ->assertJsonPath('error_code', 'RESOURCE_NOT_FOUND');
    }

    public function test_customer_create_is_idempotent_and_update_delete_preserve_the_existing_workflow(): void
    {
        $token = $this->tokenWithPermissions(['page.customers.manage']);
        $key = (string) \Illuminate\Support\Str::uuid();
        $payload = [
            'name' => 'New Customer',
            'phone' => '01012345678',
            'address' => 'Cairo',
        ];

        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/customers', $payload)
            ->assertCreated()
            ->assertJsonPath('data.name', 'New Customer');
        $customerId = $created->json('data.id');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/customers', $payload)
            ->assertCreated()
            ->assertJsonPath('data.id', $customerId);
        $this->assertSame(1, customers::query()->count());

        $this->withToken($token)
            ->putJson('/api/v1/customers/'.$customerId, [
                'name' => 'Updated Customer',
                'phone' => '01099999999',
                'address' => 'Alexandria',
            ])
            ->assertOk()
            ->assertJsonPath('data.name', 'Updated Customer');

        $this->withToken($token)
            ->deleteJson('/api/v1/customers/'.$customerId)
            ->assertNoContent();
        $this->assertDatabaseMissing('customers', ['id' => $customerId]);
    }

    private function tokenWithPermissions(array $permissions): string
    {
        $role = Role::query()->create([
            'name' => 'API reader '.uniqid(),
            'guard_name' => 'web',
        ]);

        foreach ($permissions as $permissionName) {
            $permission = Permission::query()->create([
                'name' => $permissionName,
                'guard_name' => 'web',
            ]);
            $role->givePermissionTo($permission);
        }

        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);
        $abilities = array_merge(['api:me'], $permissions);

        return $user->createToken('api-reader', $abilities)->plainTextToken;
    }
}
