<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\installments;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1InstallmentReadTest extends TestCase
{
    use RefreshDatabase;

    public function test_installment_list_is_searchable_paginated_and_excludes_notes(): void
    {
        $token = $this->tokenWithViewPermission();
        $this->installment('فاطمة', 'هاتف سامسونج');
        $this->installment('مريم', 'هاتف آخر');

        $this->withToken($token)
            ->getJson('/api/v1/installments?q=فاطمة&per_page=1')
            ->assertOk()
            ->assertJsonPath('data.0.customer', 'فاطمة')
            ->assertJsonPath('data.0.status', 'غير مكتمل')
            ->assertJsonPath('data.0.remaining', '75.00')
            ->assertJsonMissingPath('data.0.notes')
            ->assertJsonStructure(['data', 'links', 'meta']);
    }

    public function test_installment_detail_requires_page_permission(): void
    {
        $installment = $this->installment('فاطمة', 'هاتف سامسونج');
        $userWithoutPermission = User::factory()->create(['is_active' => true]);
        $tokenWithoutPermission = $userWithoutPermission->createToken('installment-reader', [
            'api:me',
            'page.installments.view',
        ]);

        $this->withToken($tokenWithoutPermission->plainTextToken)
            ->getJson('/api/v1/installments/'.$installment->id)
            ->assertForbidden();
    }

    public function test_installment_detail_requires_token_ability(): void
    {
        $installment = $this->installment('فاطمة', 'هاتف سامسونج');
        $user = $this->userWithViewPermission();
        $token = $user->createToken('installment-reader', ['api:me']);

        $this->withToken($token->plainTextToken)
            ->getJson('/api/v1/installments/'.$installment->id)
            ->assertForbidden();
    }

    public function test_authorized_installment_detail_returns_the_snapshot(): void
    {
        $installment = $this->installment('فاطمة', 'هاتف سامسونج');
        $user = $this->userWithViewPermission();
        $token = $user->createToken('installment-reader', ['api:me', 'page.installments.view']);

        $this->withToken($token->plainTextToken)
            ->getJson('/api/v1/installments/'.$installment->id)
            ->assertOk()
            ->assertJsonPath('data.customer', 'فاطمة')
            ->assertJsonPath('data.next_payment_date', '2026-12-01')
            ->assertJsonPath('data.items.0.name', 'هاتف سامسونج')
            ->assertJsonMissingPath('data.notes');
    }

    private function tokenWithViewPermission(): string
    {
        $user = $this->userWithViewPermission();
        $token = $user->createToken('installment-reader', ['api:me', 'page.installments.view']);

        return $token->plainTextToken;
    }

    private function userWithViewPermission(): User
    {
        $permission = Permission::query()->create([
            'name' => 'page.installments.view',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Installment reader', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user;
    }

    private function installment(string $customer, string $productName): installments
    {
        return installments::query()->create([
            'customer' => $customer,
            'product_name' => $productName,
            'product_price' => '100.00',
            'payment_date' => '2026-11-01',
            'next_payment_date' => '2026-12-01',
            'paid_amount' => '25.00',
            'remaining' => '75.00',
            'quantity' => 1,
            'status' => 'غير مكتمل',
            'items' => [['name' => $productName, 'quantity' => 1, 'price' => '100.00']],
            'notes' => 'ملاحظة داخلية',
        ]);
    }
}
