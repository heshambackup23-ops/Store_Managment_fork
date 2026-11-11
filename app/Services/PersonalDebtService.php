<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\PersonalDebt;
use App\Models\PersonalDebtPayment;
use App\Models\User;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PersonalDebtService
{
    public function create(array $data, User $user): PersonalDebt
    {
        return DB::transaction(function () use ($data, $user): PersonalDebt {
            $total = Money::cents($data['total_amount']);
            $paid = Money::cents($data['paid_amount'] ?? 0);
            if ($paid > $total) {
                throw ValidationException::withMessages(['paid_amount' => 'لا يمكن أن يتجاوز المدفوع إجمالي الدين.']);
            }
            $remaining = $total - $paid;
            $debt = PersonalDebt::query()->create([
                'creditor' => trim($data['creditor']),
                'description' => $this->clean($data['description'] ?? null, 255),
                'total_amount' => Money::decimal($total),
                'paid_amount' => Money::decimal($paid),
                'remaining' => Money::decimal($remaining),
                'due_date' => $data['due_date'] ?? null,
                'status' => $remaining === 0 ? 'paid' : 'open',
                'notes' => $this->clean($data['notes'] ?? null, 2000),
                'created_by' => $user->id,
            ]);
            if ($paid > 0) {
                PersonalDebtPayment::query()->forceCreate([
                    'personal_debt_id' => $debt->id,
                    'amount' => Money::decimal($paid),
                    'paid_on' => now()->toDateString(),
                    'notes' => 'دفعة عند إنشاء الدين',
                    'created_by' => $user->id,
                ]);
            }
            return $debt;
        }, 3);
    }

    public function update(PersonalDebt $debt, array $data): PersonalDebt
    {
        return DB::transaction(function () use ($debt, $data): PersonalDebt {
            $locked = PersonalDebt::query()->lockForUpdate()->findOrFail($debt->id);
            $total = Money::cents($data['total_amount']);
            $paid = Money::cents($locked->paid_amount);
            if ($total < $paid) {
                throw ValidationException::withMessages(['total_amount' => 'لا يمكن أن يكون الإجمالي أقل من المبلغ المدفوع.']);
            }
            $remaining = $total - $paid;
            $locked->update([
                'creditor' => trim($data['creditor']),
                'description' => $this->clean($data['description'] ?? null, 255),
                'total_amount' => Money::decimal($total),
                'remaining' => Money::decimal($remaining),
                'due_date' => $data['due_date'] ?? null,
                'status' => $remaining === 0 ? 'paid' : 'open',
                'notes' => $this->clean($data['notes'] ?? null, 2000),
            ]);
            return $locked->refresh();
        }, 3);
    }

    public function pay(PersonalDebt $debt, string|float $amount, ?string $notes, User $user): PersonalDebt
    {
        return DB::transaction(function () use ($debt, $amount, $notes, $user): PersonalDebt {
            $locked = PersonalDebt::query()->lockForUpdate()->findOrFail($debt->id);
            $payment = Money::cents($amount);
            $remaining = Money::cents($locked->remaining);
            if ($payment <= 0 || $payment > $remaining) {
                throw ValidationException::withMessages(['amount' => 'يجب أن تكون الدفعة أكبر من صفر ولا تتجاوز المتبقي.']);
            }
            $paid = Money::cents($locked->paid_amount) + $payment;
            $remaining -= $payment;
            PersonalDebtPayment::query()->forceCreate([
                'personal_debt_id' => $locked->id,
                'amount' => Money::decimal($payment),
                'paid_on' => now()->toDateString(),
                'notes' => $this->clean($notes, 500),
                'created_by' => $user->id,
            ]);
            $locked->update([
                'paid_amount' => Money::decimal($paid),
                'remaining' => Money::decimal($remaining),
                'status' => $remaining === 0 ? 'paid' : 'open',
            ]);
            AppNotification::query()->create([
                'title' => 'تم سداد دين شخصي',
                'message' => 'تم تسجيل دفعة بمبلغ '.Money::decimal($payment).' للدائن '.$locked->creditor,
                'is_active' => true,
                'created_by' => $user->id,
            ]);
            return $locked->refresh();
        }, 3);
    }

    public function delete(PersonalDebt $debt): void
    {
        DB::transaction(function () use ($debt): void {
            $locked = PersonalDebt::query()->lockForUpdate()->findOrFail($debt->id);
            if ($locked->payments()->exists()) {
                throw ValidationException::withMessages(['debt' => 'لا يمكن حذف دين له سجل دفعات.']);
            }
            $locked->delete();
        }, 3);
    }

    private function clean(?string $value, int $max): ?string
    {
        if ($value === null) return null;
        $value = trim((string) preg_replace('/\s+/u', ' ', $value));
        return $value === '' ? null : mb_substr($value, 0, $max);
    }
}
