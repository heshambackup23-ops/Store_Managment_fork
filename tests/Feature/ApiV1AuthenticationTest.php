<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_active_user_can_issue_a_scoped_token_and_read_a_minimal_user_resource(): void
    {
        $permission = Permission::query()->create([
            'name' => 'page.products.view',
            'guard_name' => 'web',
        ]);
        $role = Role::query()->create(['name' => 'Mobile product viewer', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create([
            'name' => 'Mobile User',
            'username' => 'mobile.user',
            'password' => 'correct-password',
            'is_active' => true,
            'system_account' => null,
        ]);
        $user->assignRole($role);

        $response = $this->postJson('/api/v1/auth/token', [
            'username' => ' MOBILE.USER ',
            'password' => 'correct-password',
            'device_name' => 'Test phone',
        ])->assertCreated()
            ->assertJsonPath('data.token_type', 'Bearer')
            ->assertJsonPath('data.user.id', $user->id)
            ->assertJsonPath('data.user.username', 'mobile.user')
            ->assertJsonPath('data.user.roles.0', 'Mobile product viewer')
            ->assertJsonPath('data.user.permissions.0', 'page.products.view');

        $plainTextToken = $response->json('data.access_token');
        $this->assertIsString($plainTextToken);
        $this->assertNotSame('', $plainTextToken);
        $this->assertDatabaseHas('personal_access_tokens', [
            'tokenable_id' => $user->id,
            'name' => 'Test phone',
        ]);

        $this->withToken($plainTextToken)
            ->getJson('/api/v1/me')
            ->assertOk()
            ->assertJsonPath('data.id', $user->id)
            ->assertJsonMissingPath('data.password')
            ->assertJsonMissingPath('data.email')
            ->assertJsonMissingPath('data.system_account');
    }

    public function test_invalid_or_inactive_credentials_do_not_issue_a_token(): void
    {
        $user = User::factory()->create([
            'username' => 'inactive.user',
            'password' => 'correct-password',
            'is_active' => false,
        ]);

        $this->postJson('/api/v1/auth/token', [
            'username' => $user->username,
            'password' => 'wrong-password',
            'device_name' => 'Test phone',
        ])->assertUnauthorized()->assertJsonPath('error_code', 'AUTHENTICATION_FAILED');

        $this->postJson('/api/v1/auth/token', [
            'username' => $user->username,
            'password' => 'correct-password',
            'device_name' => 'Test phone',
        ])->assertUnauthorized()->assertJsonPath('error_code', 'AUTHENTICATION_FAILED');

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_token_validation_uses_the_api_error_contract(): void
    {
        $this->postJson('/api/v1/auth/token', [
            'username' => 'invalid name',
            'password' => 'secret',
        ])->assertUnprocessable()
            ->assertJsonPath('error_code', 'VALIDATION_FAILED')
            ->assertJsonStructure(['message', 'error_code', 'errors' => ['username', 'device_name']]);
    }

    public function test_business_validation_exceptions_use_the_api_error_contract(): void
    {
        Route::get('/api/v1/test-validation', static function () {
            throw ValidationException::withMessages(['amount' => ['Amount is invalid.']]);
        });

        $this->getJson('/api/v1/test-validation')
            ->assertUnprocessable()
            ->assertJsonPath('error_code', 'VALIDATION_FAILED')
            ->assertJsonPath('errors.amount.0', 'Amount is invalid.');
    }

    public function test_token_issue_endpoint_uses_the_login_rate_limit(): void
    {
        $payload = [
            'username' => 'rate.limited',
            'password' => 'wrong-password',
            'device_name' => 'Test phone',
        ];

        foreach (range(1, 5) as $_attempt) {
            $this->postJson('/api/v1/auth/token', $payload)->assertUnauthorized();
        }

        $this->postJson('/api/v1/auth/token', $payload)
            ->assertTooManyRequests()
            ->assertJsonPath('error_code', 'RATE_LIMITED');
    }

    public function test_me_requires_the_api_me_token_ability_and_active_user(): void
    {
        $user = User::factory()->create(['is_active' => true]);
        $token = $user->createToken('wrong-scope', ['page.products.view']);

        $this->withToken($token->plainTextToken)->getJson('/api/v1/me')->assertForbidden();

        $token = $user->createToken('inactive-account', ['api:me']);
        $user->forceFill(['is_active' => false])->save();

        $this->withToken($token->plainTextToken)->getJson('/api/v1/me')->assertForbidden();
    }

    public function test_legacy_current_user_endpoint_rejects_inactive_accounts(): void
    {
        $user = User::factory()->create(['is_active' => false]);
        $token = $user->createToken('inactive-account', ['*']);

        $this->withToken($token->plainTextToken)
            ->getJson('/api/user')
            ->assertForbidden();
    }

    public function test_logout_revokes_only_the_current_personal_access_token(): void
    {
        $user = User::factory()->create(['is_active' => true]);
        $current = $user->createToken('current-device', ['api:me']);
        $other = $user->createToken('other-device', ['api:me']);

        $this->withToken($current->plainTextToken)
            ->deleteJson('/api/v1/auth/token')
            ->assertNoContent();

        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $current->accessToken->id]);
        $this->assertDatabaseHas('personal_access_tokens', ['id' => $other->accessToken->id]);
    }
}
