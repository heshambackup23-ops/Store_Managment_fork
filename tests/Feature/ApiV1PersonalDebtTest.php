<?php

namespace Tests\Feature;

use App\Models\PersonalDebt;
use App\Models\PersonalDebtPayment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class ApiV1PersonalDebtTest extends TestCase
{
    use RefreshDatabase;

    public function test_personal_debt_can_be_created_edited_partially_paid_and_closed(): void
    {
        $token = $this->managerToken();
        $created = $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/personal-debts', [
                'creditor' => 'Supplier outside store',
                'description' => 'Personal loan',
                'total_amount' => '500.00',
                'due_date' => '2026-12-01',
                'notes' => null,
            ])
            ->assertCreated()
            ->assertJsonPath('data.remaining', '500.00');
        $id = $created->json('data.id');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->putJson('/api/v1/personal-debts/'.$id, [
                'creditor' => 'Updated creditor',
                'description' => null,
                'total_amount' => '600.00',
                'due_date' => null,
                'notes' => null,
            ])
            ->assertOk()
            ->assertJsonPath('data.creditor', 'Updated creditor')
            ->assertJsonPath('data.remaining', '600.00');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/personal-debts/'.$id.'/pay', ['amount' => '200.00'])
            ->assertOk()
            ->assertJsonPath('data.paid_amount', '200.00')
            ->assertJsonPath('data.remaining', '400.00')
            ->assertJsonCount(1, 'data.payments');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->postJson('/api/v1/personal-debts/'.$id.'/pay', ['amount' => '400.00'])
            ->assertOk()
            ->assertJsonPath('data.status', 'paid')
            ->assertJsonPath('data.remaining', '0.00');

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->deleteJson('/api/v1/personal-debts/'.$id)
            ->assertUnprocessable();

        $this->assertSame(2, PersonalDebtPayment::query()->count());
    }

    public function test_unpaid_personal_debt_can_be_deleted(): void
    {
        $token = $this->managerToken();
        $debt = PersonalDebt::query()->create([
            'creditor' => 'Creditor',
            'total_amount' => '100.00',
            'paid_amount' => '0.00',
            'remaining' => '100.00',
            'status' => 'open',
        ]);

        $this->withToken($token)
            ->withHeader('Idempotency-Key', (string) Str::uuid())
            ->deleteJson('/api/v1/personal-debts/'.$debt->id)
            ->assertNoContent();

        $this->assertDatabaseMissing('personal_debts', ['id' => $debt->id]);
    }

    private function managerToken(): string
    {
        $permission = Permission::query()->create(['name' => 'page.installments.manage', 'guard_name' => 'web']);
        $role = Role::query()->create(['name' => 'Personal debt manager', 'guard_name' => 'web']);
        $role->givePermissionTo($permission);
        $user = User::factory()->create(['is_active' => true]);
        $user->assignRole($role);
        return $user->createToken('personal-debt-manager', [
            'api:me', 'page.installments.view', 'page.installments.manage',
        ])->plainTextToken;
    }
}
