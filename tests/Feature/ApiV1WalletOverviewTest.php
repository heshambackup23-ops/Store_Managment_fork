<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Wallet;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1WalletOverviewTest extends TestCase
{
    use RefreshDatabase;

    public function test_wallet_overview_returns_ledger_summary_without_private_notes(): void
    {
        $token = $this->tokenWithWalletViewPermission();
        Wallet::query()->forceCreate([
            'name' => 'Main wallet',
            'provider' => 'vodafone_cash',
            'identifier' => '01012345678',
            'opening_balance' => '250.00',
            'balance' => '250.00',
            'is_active' => true,
            'notes' => 'Private wallet note',
        ]);

        $this->withToken($token)
            ->getJson('/api/v1/wallets')
            ->assertOk()
            ->assertJsonPath('data.summary.wallets_total', '250.00')
            ->assertJsonPath('data.wallets.0.name', 'Main wallet')
            ->assertJsonPath('data.wallets.0.provider', 'فودافون كاش')
            ->assertJsonPath('data.wallets.0.balance', '250.00')
            ->assertJsonMissingPath('data.wallets.0.notes');
    }

    public function test_wallet_overview_requires_current_permission_and_token_ability(): void
    {
        $user = User::factory()->create(['is_active' => true]);
        $overbroadToken = $user->createToken('wallet-viewer', ['api:me', 'page.wallets.view']);
        $this->withToken($overbroadToken->plainTextToken)
            ->getJson('/api/v1/wallets')
            ->assertForbidden();

        $manager = $this->userWithWalletViewPermission();
        $wrongScope = $manager->createToken('wrong-wallet-scope', ['api:me']);
        $this->withToken($wrongScope->plainTextToken)
            ->getJson('/api/v1/wallets')
            ->assertForbidden();
    }

    public function test_wallet_manager_can_create_adjust_and_toggle_a_wallet(): void
    {
        $token = $this->tokenWithWalletManagePermission();
        $createKey = (string) Str::uuid();
        $payload = [
            'name' => 'Store wallet',
            'provider' => 'vodafone_cash',
            'opening_balance' => '50.00',
        ];

        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', $createKey)
            ->postJson('/api/v1/wallets', $payload)
            ->assertCreated();
        $walletId = $created->json('data.id');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', $createKey)
            ->postJson('/api/v1/wallets', $payload)
            ->assertCreated()
            ->assertJsonPath('data.id', $walletId);

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/wallets/'.$walletId.'/adjust', ['amount' => '25.00', 'reason' => 'Balance correction'])
            ->assertCreated();

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/wallets/'.$walletId.'/toggle')
            ->assertOk()
            ->assertJsonPath('data.is_active', false);

        $this->assertSame('75.00', number_format((float) Wallet::query()->findOrFail($walletId)->balance, 2, '.', ''));
        $this->assertDatabaseCount('wallet_transactions', 1);
    }

    public function test_wallet_viewer_cannot_use_management_endpoints(): void
    {
        $token = $this->tokenWithWalletViewPermission();

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/wallets', [
                'name' => 'Not allowed',
                'provider' => 'other',
                'opening_balance' => '0.00',
            ])
            ->assertForbidden();
    }

    private function tokenWithWalletViewPermission(): string
    {
        return $this->userWithWalletViewPermission()
            ->createToken('wallet-reader', ['api:me', 'page.wallets.view'])
            ->plainTextToken;
    }

    private function userWithWalletViewPermission(): User
    {
        $permission = Permission::query()->create([
            'name' => 'page.wallets.view',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Wallet viewer', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user;
    }

    private function tokenWithWalletManagePermission(): string
    {
        $permission = Permission::query()->create([
            'name' => 'page.wallets.manage',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Wallet manager', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);

        return $user->createToken('wallet-manager', [
            'api:me',
            'page.wallets.view',
            'page.wallets.manage',
        ])->plainTextToken;
    }
}
