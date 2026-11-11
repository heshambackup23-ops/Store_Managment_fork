<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1WalletCashierTest extends TestCase
{
    use RefreshDatabase;

    public function test_cashier_records_idempotently_and_settles_deferred_transactions(): void
    {
        $token = $this->managerToken();
        $wallet = $this->wallet();
        $key = (string) Str::uuid();
        $payload = [
            'wallet_id' => $wallet->id,
            'type' => 'send',
            'amount' => '100.00',
            'counterparty' => '01012345678',
            'payment_method' => 'deferred',
            'customer_name' => 'Layla Ahmed',
        ];

        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/wallet-cashier', $payload)
            ->assertCreated();
        $uuid = $created->json('data.uuid');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', $key)
            ->postJson('/api/v1/wallet-cashier', $payload)
            ->assertCreated()
            ->assertJsonPath('data.uuid', $uuid);

        $this->withToken($token)
            ->getJson('/api/v1/wallet-cashier')
            ->assertOk()
            ->assertJsonPath('data.outstanding', '100.00')
            ->assertJsonPath('data.transactions.0.uuid', $uuid)
            ->assertJsonPath('data.transactions.0.can_settle', true);

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/wallet-cashier/'.$uuid.'/settle', ['amount' => '25.00'])
            ->assertCreated();

        $this->withToken($token)
            ->getJson('/api/v1/wallet-cashier')
            ->assertOk()
            ->assertJsonPath('data.outstanding', '75.00');

        $this->assertSame(2, WalletTransaction::query()->count());
    }

    public function test_cashier_reverses_by_adding_a_ledger_reversal_not_deleting(): void
    {
        $token = $this->managerToken();
        $wallet = $this->wallet();
        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/wallet-cashier', [
                'wallet_id' => $wallet->id,
                'type' => 'send',
                'amount' => '20.00',
                'counterparty' => '01012345678',
            ])
            ->assertCreated();
        $uuid = $created->json('data.uuid');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/wallet-cashier/'.$uuid.'/reverse', ['reason' => 'Wrong amount'])
            ->assertCreated();

        $this->assertSame(2, WalletTransaction::query()->count());
        $this->assertDatabaseHas('wallet_transactions', ['uuid' => $uuid, 'status' => 'reversed']);
    }

    private function wallet(): Wallet
    {
        return Wallet::query()->forceCreate([
            'name' => 'Main wallet',
            'provider' => 'other',
            'identifier' => '01098765432',
            'opening_balance' => '500.00',
            'balance' => '500.00',
            'is_active' => true,
        ]);
    }

    private function managerToken(): string
    {
        $role = Role::query()->create(['name' => 'Wallet cashier manager', 'guard_name' => 'web']);
        $permissions = collect(['page.wallet_cashier.view', 'page.wallet_cashier.manage', 'page.wallets.manage'])
            ->map(fn (string $name) => Permission::query()->create(['name' => $name, 'guard_name' => 'web']));
        $role->givePermissionTo($permissions);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user->createToken('wallet-cashier-manager', [
            'api:me',
            'page.wallet_cashier.view',
            'page.wallet_cashier.manage',
            'page.wallets.manage',
        ])->plainTextToken;
    }
}
