<?php

namespace App\Services\Wallets;

use App\Models\customers;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletAuditLog;
use App\Models\WalletCashAdjustment;
use App\Models\WalletExpense;
use App\Models\WalletTransaction;
use App\Support\Digits;
use App\Support\Money;
use Carbon\CarbonInterface;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * The ONLY place that changes a wallet balance.
 *
 * Rules that keep real money safe:
 *  - every operation runs in one DB transaction and locks the wallet row first,
 *    so two cashiers can never overspend, exceed a limit, or double-submit;
 *  - amounts are integer cents, never floats;
 *  - ledger rows are append-only. A mistake is fixed with a reversal row;
 *  - the same idempotency key can never create two transactions;
 *  - every operation writes an audit log row.
 *
 * Invariants (checked by `php artisan wallets:reconcile`):
 *  wallet.balance = wallet.opening_balance + SUM(wallet_transactions.wallet_delta)
 */
class WalletLedgerService
{
    public const SEND = 'send';          // customer pays cash, we send from the wallet
    public const RECEIVE = 'receive';    // customer sends to our wallet, we pay cash
    public const REVERSAL = 'reversal';
    public const SETTLEMENT = 'settlement';
    public const ADJUSTMENT = 'adjustment';
    public const PROFIT_WITHDRAWAL = 'profit_withdrawal';

    // ------------------------------------------------------------------ record

    /**
     * @param  array{wallet_id:int,type:string,amount:string|float,commission?:string|float|null,fee?:string|float|null,counterparty?:?string,payment_method?:?string,customer_id?:?int,customer_name?:?string,notes?:?string,idempotency_key?:?string}  $input
     */
    public function record(array $input, User $user, ?string $ip = null): WalletTransaction
    {
        return DB::transaction(function () use ($input, $user, $ip): WalletTransaction {
            $wallet = Wallet::query()->lockForUpdate()->find($input['wallet_id'] ?? 0);

            if (! $wallet) {
                $this->fail('wallet_id', 'المحفظة غير موجودة.');
            }

            if (! $wallet->is_active) {
                $this->fail('wallet_id', 'هذه المحفظة موقوفة ولا يمكن إجراء عمليات عليها.');
            }

            // Checked AFTER the wallet lock, so concurrent duplicates wait here and then find the first one.
            $key = $input['idempotency_key'] ?? null;
            if ($key) {
                $existing = WalletTransaction::query()->where('idempotency_key', $key)->first();
                if ($existing) {
                    // A key may only ever replay the identical request, never hand back another operation.
                    if ((int) $existing->wallet_id !== (int) $wallet->id
                        || $existing->type !== ($input['type'] ?? null)
                        || Money::cents($existing->amount) !== Money::cents($input['amount'] ?? 0)) {
                        $this->fail('idempotency_key', 'هذا الطلب استُخدم من قبل لعملية مختلفة. حدّث الصفحة وأعد المحاولة.');
                    }

                    return $existing;
                }
            }

            $type = (string) ($input['type'] ?? '');
            if (! in_array($type, [self::SEND, self::RECEIVE], true)) {
                $this->fail('type', 'نوع العملية غير صالح.');
            }

            $amount = Money::cents($input['amount'] ?? 0);
            $commission = Money::cents($input['commission'] ?? 0);
            $fee = Money::cents($input['fee'] ?? 0);
            $method = $type === self::SEND ? (($input['payment_method'] ?? null) ?: 'cash') : 'cash';

            if ($amount <= 0) {
                $this->fail('amount', 'المبلغ يجب أن يكون أكبر من صفر.');
            }
            if ($commission < 0 || $fee < 0) {
                $this->fail('commission', 'العمولة والرسوم لا يمكن أن تكون سالبة.');
            }
            if ($commission > $amount) {
                $this->fail('commission', 'العمولة لا يمكن أن تتجاوز مبلغ العملية.');
            }
            if ($fee > $amount) {
                $this->fail('fee', 'رسوم المزود لا يمكن أن تتجاوز مبلغ العملية.');
            }
            if (! in_array($method, ['cash', 'deferred'], true)) {
                $this->fail('payment_method', 'طريقة الدفع غير صالحة.');
            }

            // Defence in depth: the form request already checks this, but the service never trusts its caller.
            $counterparty = $this->clean($input['counterparty'] ?? null, 64);

            if ($counterparty !== null) {
                $counterparty = Digits::identifier($counterparty);

                if (! Digits::isPhoneOrInstapay($counterparty)) {
                    $this->fail('counterparty', 'رقم الطرف الآخر غير صالح. اكتب رقم هاتف صحيح أو عنوان إنستا باي.');
                }

                // A transfer from a wallet to itself is always a typing mistake.
                if ($wallet->identifier !== null && $wallet->identifier !== '' && $counterparty === Digits::identifier($wallet->identifier)) {
                    $this->fail('counterparty', 'رقم الطرف الآخر هو نفس رقم المحفظة.');
                }
            }

            [$customerId, $customerName] = $this->resolveCustomer($input);
            if ($method === 'deferred' && $customerName === null) {
                $this->fail('customer_name', 'اسم العميل مطلوب للعمليات الآجلة.');
            }

            // Per-transaction limit.
            $perTransaction = $wallet->limitCents('per_transaction_limit');
            if ($perTransaction !== null && $amount > $perTransaction) {
                $this->fail('amount', 'المبلغ أكبر من الحد الأقصى للعملية الواحدة ('.Money::format($perTransaction).' جنيه).');
            }

            // Daily / monthly limits (calendar day and month in the app timezone).
            $now = now();
            $usage = $this->usageFor($wallet, $now);
            $periodChecks = $type === self::SEND
                ? [['daily_send_limit', 'sent_day', 'اليومي للتحويل'], ['monthly_send_limit', 'sent_month', 'الشهري للتحويل']]
                : [['daily_receive_limit', 'received_day', 'اليومي للاستلام'], ['monthly_receive_limit', 'received_month', 'الشهري للاستلام']];

            foreach ($periodChecks as [$limitColumn, $usedKey, $label]) {
                $limit = $wallet->limitCents($limitColumn);

                if ($limit !== null && $usage[$usedKey] + $amount > $limit) {
                    $remaining = max(0, $limit - $usage[$usedKey]);
                    $this->fail('amount', "تجاوز الحد {$label}. المتبقي: ".Money::format($remaining).' جنيه.');
                }
            }

            // Wallet balance can never go negative.
            $balance = Money::cents($wallet->balance);
            $walletDelta = $type === self::SEND ? -($amount + $fee) : ($amount - $fee);
            $newBalance = $balance + $walletDelta;

            if ($newBalance < 0) {
                $this->fail('amount', 'رصيد المحفظة غير كافٍ. المتاح: '.Money::format($balance).' جنيه.');
            }

            // Cash drawer and customer debt.
            if ($type === self::SEND) {
                $owed = $amount + $commission;
                $cashDelta = $method === 'cash' ? $owed : 0;
                $receivable = $method === 'deferred' ? $owed : 0;
            } else {
                $cashDelta = -($amount - $commission);
                $receivable = 0;
            }

            $transaction = WalletTransaction::query()->forceCreate([
                'wallet_id' => $wallet->id,
                'type' => $type,
                'status' => 'completed',
                'amount' => Money::decimal($amount),
                'commission' => Money::decimal($commission),
                'fee' => Money::decimal($fee),
                'profit' => Money::decimal($commission - $fee),
                'wallet_delta' => Money::decimal($walletDelta),
                'cash_delta' => Money::decimal($cashDelta),
                'balance_after' => Money::decimal($newBalance),
                'payment_method' => $method,
                'receivable' => Money::decimal($receivable),
                'counterparty' => $counterparty,
                'customer_id' => $customerId,
                'customer_name' => $customerName,
                'notes' => $this->clean($input['notes'] ?? null, 500),
                'idempotency_key' => $key ?: null,
                'occurred_at' => $now,
                'created_by' => $user->id,
                'created_by_name' => $user->name,
            ]);

            $wallet->forceFill(['balance' => Money::decimal($newBalance)])->save();

            $this->audit($user, 'transaction.created', 'wallet_transaction', $transaction->id, [
                'wallet_id' => $wallet->id,
                'type' => $type,
                'amount' => Money::decimal($amount),
                'commission' => Money::decimal($commission),
                'method' => $method,
            ], $ip);

            return $transaction;
        }, 3);
    }

    // ----------------------------------------------------------------- reverse

    /**
     * Undo a mistaken transaction: the original is marked reversed (and stops
     * counting toward limits and reports) and an opposite ledger row is added.
     */
    public function reverse(WalletTransaction $transaction, string $reason, User $user, ?string $ip = null): WalletTransaction
    {
        return DB::transaction(function () use ($transaction, $reason, $user, $ip): WalletTransaction {
            // Same lock order as record(): wallet first, then the transaction.
            $wallet = Wallet::query()->lockForUpdate()->findOrFail($transaction->wallet_id);
            $original = WalletTransaction::query()->lockForUpdate()->findOrFail($transaction->id);

            if (! $original->isMoneyMovement()) {
                $this->fail('transaction', 'لا يمكن عكس هذا النوع من القيود.');
            }
            if ($original->status !== 'completed') {
                $this->fail('transaction', 'تم عكس هذه العملية من قبل.');
            }
            if (WalletTransaction::query()->where('settles_id', $original->id)->exists()) {
                $this->fail('transaction', 'تم تحصيل جزء من هذه العملية الآجلة. صحّح الوضع بتسوية يدوية بدلاً من العكس.');
            }

            $delta = -Money::cents($original->wallet_delta);
            $newBalance = Money::cents($wallet->balance) + $delta;

            if ($newBalance < 0) {
                $this->fail('transaction', 'لا يمكن عكس العملية لأن رصيد المحفظة الحالي لا يكفي.');
            }

            $reversal = WalletTransaction::query()->forceCreate([
                'wallet_id' => $wallet->id,
                'type' => self::REVERSAL,
                'status' => 'completed',
                'wallet_delta' => Money::decimal($delta),
                'cash_delta' => Money::decimal(-Money::cents($original->cash_delta)),
                'balance_after' => Money::decimal($newBalance),
                'reverses_id' => $original->id,
                'customer_id' => $original->customer_id,
                'customer_name' => $original->customer_name,
                'counterparty' => $original->counterparty,
                'notes' => $this->clean($reason, 500),
                'occurred_at' => now(),
                'created_by' => $user->id,
                'created_by_name' => $user->name,
            ]);

            $original->forceFill([
                'status' => 'reversed',
                'reversed_at' => now(),
                'reversed_by' => $user->id,
                'reversal_reason' => $this->clean($reason, 255),
                'receivable' => '0.00',
            ])->save();

            $wallet->forceFill(['balance' => Money::decimal($newBalance)])->save();

            $this->audit($user, 'transaction.reversed', 'wallet_transaction', $original->id, [
                'reversal_id' => $reversal->id,
                'reason' => $reason,
            ], $ip);

            return $reversal;
        }, 3);
    }

    // ------------------------------------------------------------------ settle

    /**
     * Collect money (all or part) for a deferred transfer. Moves cash into the drawer.
     */
    public function settle(WalletTransaction $transaction, string|float|null $amount, User $user, ?string $ip = null): WalletTransaction
    {
        return DB::transaction(function () use ($transaction, $amount, $user, $ip): WalletTransaction {
            $wallet = Wallet::query()->lockForUpdate()->findOrFail($transaction->wallet_id);
            $original = WalletTransaction::query()->lockForUpdate()->findOrFail($transaction->id);

            if ($original->status !== 'completed' || $original->payment_method !== 'deferred') {
                $this->fail('transaction', 'هذه العملية ليست آجلة أو تم إلغاؤها.');
            }

            $outstanding = Money::cents($original->receivable);
            if ($outstanding <= 0) {
                $this->fail('transaction', 'تم تحصيل هذه العملية بالكامل.');
            }

            $pay = ($amount === null || $amount === '') ? $outstanding : Money::cents($amount);
            if ($pay <= 0 || $pay > $outstanding) {
                $this->fail('amount', 'مبلغ التحصيل غير صحيح. المتبقي على العميل: '.Money::format($outstanding).' جنيه.');
            }

            $settlement = WalletTransaction::query()->forceCreate([
                'wallet_id' => $wallet->id,
                'type' => self::SETTLEMENT,
                'status' => 'completed',
                'cash_delta' => Money::decimal($pay),
                'balance_after' => $wallet->balance,
                'settles_id' => $original->id,
                'customer_id' => $original->customer_id,
                'customer_name' => $original->customer_name,
                'occurred_at' => now(),
                'created_by' => $user->id,
                'created_by_name' => $user->name,
            ]);

            $left = $outstanding - $pay;
            $original->forceFill([
                'receivable' => Money::decimal($left),
                'settled_at' => $left === 0 ? now() : null,
            ])->save();

            $this->audit($user, 'transaction.settled', 'wallet_transaction', $original->id, [
                'settlement_id' => $settlement->id,
                'paid' => Money::decimal($pay),
                'remaining' => Money::decimal($left),
            ], $ip);

            return $settlement;
        }, 3);
    }

    // ------------------------------------------------------------------ adjust

    /**
     * Manual correction of a wallet balance (for example after comparing with the
     * provider's app). Always needs a reason and leaves an audit trail.
     */
    public function adjust(Wallet $wallet, string|float $signedAmount, string $reason, User $user, ?string $ip = null): WalletTransaction
    {
        return DB::transaction(function () use ($wallet, $signedAmount, $reason, $user, $ip): WalletTransaction {
            $locked = Wallet::query()->lockForUpdate()->findOrFail($wallet->id);
            $delta = Money::cents($signedAmount);

            if ($delta === 0) {
                $this->fail('amount', 'مبلغ التسوية لا يمكن أن يكون صفراً.');
            }

            $newBalance = Money::cents($locked->balance) + $delta;
            if ($newBalance < 0) {
                $this->fail('amount', 'التسوية ستجعل رصيد المحفظة سالباً.');
            }

            $row = WalletTransaction::query()->forceCreate([
                'wallet_id' => $locked->id,
                'type' => self::ADJUSTMENT,
                'status' => 'completed',
                'wallet_delta' => Money::decimal($delta),
                'balance_after' => Money::decimal($newBalance),
                'notes' => $this->clean($reason, 500),
                'occurred_at' => now(),
                'created_by' => $user->id,
                'created_by_name' => $user->name,
            ]);

            $locked->forceFill(['balance' => Money::decimal($newBalance)])->save();

            $this->audit($user, 'wallet.adjusted', 'wallet', $locked->id, [
                'delta' => Money::decimal($delta),
                'reason' => $reason,
            ], $ip);

            return $row;
        }, 3);
    }

    // ------------------------------------------------------------------ usage

    /**
     * How much of each limit is already used, in cents. Reversed transactions and
     * reversal rows are excluded, so a corrected mistake frees the limit again.
     *
     * @return array{sent_day:int,received_day:int,sent_month:int,received_month:int}
     */
    public function usageFor(Wallet $wallet, ?CarbonInterface $at = null): array
    {
        return $this->usageForWallets([$wallet], $at)[$wallet->id];
    }

    /**
     * Usage for many wallets with ONE query (no query per wallet), keyed by wallet id.
     * Served by the (wallet_id, status, occurred_at, type) index.
     *
     * @param  iterable<Wallet>  $wallets
     * @return array<int, array{sent_day:int,received_day:int,sent_month:int,received_month:int}>
     */
    public function usageForWallets(iterable $wallets, ?CarbonInterface $at = null): array
    {
        $ids = collect($wallets)->pluck('id')->map(fn ($id) => (int) $id)->all();
        $empty = ['sent_day' => 0, 'received_day' => 0, 'sent_month' => 0, 'received_month' => 0];
        $result = array_fill_keys($ids, $empty);

        if ($ids === []) {
            return $result;
        }

        $at ??= now();
        $dayStart = $at->copy()->startOfDay()->format('Y-m-d H:i:s');
        $monthStart = $at->copy()->startOfMonth()->format('Y-m-d H:i:s');

        $rows = WalletTransaction::query()
            ->select('wallet_id')
            ->selectRaw(
                "COALESCE(SUM(CASE WHEN type = 'send' THEN amount END), 0) AS sent_month,
                 COALESCE(SUM(CASE WHEN type = 'receive' THEN amount END), 0) AS received_month,
                 COALESCE(SUM(CASE WHEN type = 'send' AND occurred_at >= ? THEN amount END), 0) AS sent_day,
                 COALESCE(SUM(CASE WHEN type = 'receive' AND occurred_at >= ? THEN amount END), 0) AS received_day",
                [$dayStart, $dayStart]
            )
            ->whereIn('wallet_id', $ids)
            ->whereIn('type', [self::SEND, self::RECEIVE])
            ->where('status', 'completed')
            ->where('occurred_at', '>=', $monthStart)
            ->groupBy('wallet_id')
            ->get();

        foreach ($rows as $row) {
            $result[(int) $row->wallet_id] = [
                'sent_day' => Money::cents($row->sent_day),
                'received_day' => Money::cents($row->received_day),
                'sent_month' => Money::cents($row->sent_month),
                'received_month' => Money::cents($row->received_month),
            ];
        }

        return $result;
    }

    /**
     * Rows for the "limits" progress bars.
     *
     * @return array<int, array{label:string,used:int,limit:?int,remaining:?int,percent:?int,level:string}>
     */
    public function limitRows(Wallet $wallet, array $usage): array
    {
        $definitions = [
            ['daily_send_limit', 'sent_day', 'تحويل يومي'],
            ['monthly_send_limit', 'sent_month', 'تحويل شهري'],
            ['daily_receive_limit', 'received_day', 'استلام يومي'],
            ['monthly_receive_limit', 'received_month', 'استلام شهري'],
        ];

        return array_map(function (array $definition) use ($wallet, $usage): array {
            [$column, $usedKey, $label] = $definition;
            $limit = $wallet->limitCents($column);
            $used = $usage[$usedKey];
            $percent = $limit === null ? null : min(100, intdiv($used * 100, $limit));
            $level = match (true) {
                $percent === null => 'none',
                $percent >= 100 => 'full',
                $percent >= (int) $wallet->warn_at_percent => 'warn',
                default => 'ok',
            };

            return [
                'label' => $label,
                'used' => $used,
                'limit' => $limit,
                'remaining' => $limit === null ? null : max(0, $limit - $used),
                'percent' => $percent,
                'level' => $level,
            ];
        }, $definitions);
    }

    // ---------------------------------------------------------------- totals

    /** Cash that should be in the drawer, in cents. */
    public function cashInDrawer(): int
    {
        $movements = Money::cents(WalletTransaction::query()->sum('cash_delta'));
        $adjustments = Money::cents(WalletCashAdjustment::query()->sum('amount'));
        $expenses = Money::cents(WalletExpense::query()->whereNull('voided_at')->sum('amount'));

        return $movements + $adjustments - $expenses;
    }

    /** Commission minus provider fees since the given moment, in cents. */
    public function profitSince(CarbonInterface $from): int
    {
        return Money::cents(
            WalletTransaction::query()
                ->whereIn('type', [self::SEND, self::RECEIVE])
                ->where('status', 'completed')
                ->where('occurred_at', '>=', $from->format('Y-m-d H:i:s'))
                ->sum('profit')
        );
    }

    // ------------------------------------------------------------ profit and capital
    //
    // Commission is PROFIT, kept apart from the wallet balance. The wallet balance always
    // equals the provider's app (that is what `wallets:reconcile` checks), so it can not
    // be reduced by commission. Instead profit has its own pocket:
    //   profit available  = commissions - provider fees - expenses - profit already withdrawn
    //   working capital   = wallets + cash + debts owed to us - profit available
    // Working capital does not move when you trade; only deposits, withdrawals of capital
    // and adjustments change it.

    /** Commission minus provider fees on every completed transaction, in cents. */
    public function profitTotal(): int
    {
        return Money::cents(
            WalletTransaction::query()->whereIn('type', [self::SEND, self::RECEIVE])->where('status', 'completed')->sum('profit')
        );
    }

    public function expensesTotal(): int
    {
        return Money::cents(WalletExpense::query()->whereNull('voided_at')->sum('amount'));
    }

    /** Profit the owner already took out (from the drawer or from a wallet), in cents, positive. */
    public function profitWithdrawn(): int
    {
        $fromCash = Money::cents(WalletCashAdjustment::query()->where('kind', 'profit_withdraw')->sum('amount'));
        $fromWallets = Money::cents(WalletTransaction::query()->where('type', self::PROFIT_WITHDRAWAL)->sum('wallet_delta'));

        return -($fromCash + $fromWallets);
    }

    public function profitAvailable(): int
    {
        return $this->profitTotal() - $this->expensesTotal() - $this->profitWithdrawn();
    }

    /** Deferred money customers still owe, in cents. */
    public function receivablesTotal(): int
    {
        return Money::cents(
            WalletTransaction::query()->where('status', 'completed')->where('receivable', '>', 0)->sum('receivable')
        );
    }

    public function workingCapital(): int
    {
        $wallets = Money::cents(Wallet::query()->sum('balance'));

        return $wallets + $this->cashInDrawer() + $this->receivablesTotal() - $this->profitAvailable();
    }

    /**
     * Take profit out of the business, from the cash drawer ($walletId = null) or from a wallet.
     * Never more than the profit that is available, and never more than the source holds.
     */
    public function withdrawProfit(string|float $amount, ?int $walletId, ?string $note, User $user, ?string $ip = null): void
    {
        $cents = Money::cents($amount);

        if ($cents <= 0) {
            $this->fail('amount', 'المبلغ يجب أن يكون أكبر من صفر.');
        }

        try {
            // One withdrawal at a time: two people can never take the same profit twice.
            Cache::lock('wallets:profit-withdrawal', 15)->block(5, function () use ($cents, $walletId, $note, $user, $ip): void {
                DB::transaction(function () use ($cents, $walletId, $note, $user, $ip): void {
                    $wallet = null;

                    if ($walletId !== null) {
                        $wallet = Wallet::query()->lockForUpdate()->find($walletId);

                        if (! $wallet) {
                            $this->fail('source', 'المحفظة غير موجودة.');
                        }
                    }

                    $available = $this->profitAvailable();
                    if ($cents > $available) {
                        $this->fail('amount', 'المبلغ أكبر من الأرباح المتاحة ('.Money::format(max(0, $available)).' جنيه).');
                    }

                    if ($wallet) {
                        $balance = Money::cents($wallet->balance);

                        if ($cents > $balance) {
                            $this->fail('amount', 'رصيد المحفظة لا يكفي. المتاح: '.Money::format($balance).' جنيه.');
                        }

                        $row = WalletTransaction::query()->forceCreate([
                            'wallet_id' => $wallet->id,
                            'type' => self::PROFIT_WITHDRAWAL,
                            'status' => 'completed',
                            'wallet_delta' => Money::decimal(-$cents),
                            'balance_after' => Money::decimal($balance - $cents),
                            'notes' => $this->clean($note, 500),
                            'occurred_at' => now(),
                            'created_by' => $user->id,
                            'created_by_name' => $user->name,
                        ]);
                        $wallet->forceFill(['balance' => Money::decimal($balance - $cents)])->save();
                        $subject = ['wallet_transaction', $row->id];
                    } else {
                        if ($cents > $this->cashInDrawer()) {
                            $this->fail('amount', 'النقدية في الدرج لا تكفي لسحب هذا المبلغ.');
                        }

                        $row = WalletCashAdjustment::query()->forceCreate([
                            'kind' => 'profit_withdraw',
                            'amount' => Money::decimal(-$cents),
                            'note' => $this->clean($note, 500),
                            'occurred_at' => now(),
                            'created_by' => $user->id,
                            'created_by_name' => $user->name,
                        ]);
                        $subject = ['wallet_cash_adjustment', $row->id];
                    }

                    $this->audit($user, 'profit.withdrawn', $subject[0], $subject[1], [
                        'source' => $wallet ? 'wallet' : 'cash',
                        'wallet_id' => $wallet?->id,
                        'amount' => Money::decimal($cents),
                        'note' => $note,
                    ], $ip);
                }, 3);
            });
        } catch (LockTimeoutException) {
            $this->fail('amount', 'عملية سحب أرباح أخرى قيد التنفيذ. حاول بعد لحظات.');
        }
    }

    // --------------------------------------------------------------- helpers

    public function audit(User $user, string $action, ?string $subjectType, ?int $subjectId, array $meta = [], ?string $ip = null): void
    {
        WalletAuditLog::query()->forceCreate([
            'user_id' => $user->id,
            'user_name' => $user->name,
            'action' => $action,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'meta' => $meta ?: null,
            'ip' => $ip,
        ]);
    }

    /** @return array{0:?int,1:?string} */
    private function resolveCustomer(array $input): array
    {
        $name = $this->clean($input['customer_name'] ?? null, 120);
        $customerId = ! empty($input['customer_id']) ? (int) $input['customer_id'] : null;

        if ($customerId !== null) {
            $customer = customers::query()->find($customerId);

            if (! $customer) {
                $this->fail('customer_id', 'العميل غير موجود.');
            }

            $name ??= $this->clean($customer->name, 120);
        }

        return [$customerId, $name];
    }

    private function clean(?string $value, int $max): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) preg_replace('/\s+/u', ' ', $value));

        return $value === '' ? null : mb_substr($value, 0, $max);
    }

    private function fail(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}
