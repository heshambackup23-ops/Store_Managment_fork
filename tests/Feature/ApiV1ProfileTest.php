<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApiV1ProfileTest extends TestCase
{
    use RefreshDatabase;

    public function test_authenticated_user_can_read_and_update_only_their_profile_name_and_email(): void
    {
        $user = User::factory()->create(['is_active' => true, 'name' => 'Before', 'email' => 'before@example.test']);
        $token = $user->createToken('profile-editor', ['api:me']);
        $this->withToken($token->plainTextToken)
            ->getJson('/api/v1/profile')
            ->assertOk()
            ->assertJsonPath('data.email', 'before@example.test');

        $this->withToken($token->plainTextToken)
            ->putJson('/api/v1/profile', ['name' => 'After', 'email' => 'after@example.test'])
            ->assertOk()
            ->assertJsonPath('data.name', 'After')
            ->assertJsonPath('data.email', 'after@example.test');

        $this->assertSame('After', $user->fresh()->name);
        $this->assertSame('after@example.test', $user->fresh()->email);
        $this->assertSame(1, $user->tokens()->count());
    }
}
