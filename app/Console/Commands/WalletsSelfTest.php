<?php

namespace App\Console\Commands;

use App\Models\DamagedItem;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Models\products;
use App\Services\DamagedStockService;
use App\Services\Wallets\WalletLedgerService;
use App\Support\Digits;
use App\Support\Money;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use LogicException;

/**
 * Runs the wallet and damaged-stock rules against the REAL database, inside one
 * transaction that is ALWAYS rolled back, so nothing is saved and no real wallet
 * or product is touched. Run it after installing and after every update:
 *
 *     php artisan wallets:selftest
 */
class WalletsSelfTest extends Command
{
    protected $signature = 'wallets:selftest';

    protected $description = 'Test the wallet ledger and damaged-stock logic (everything is rolled back, nothing is saved)';

    private int $failures = 0;

    private int $checks = 0;

    public function handle(WalletLedgerService $ledger, DamagedStockService $damaged): int
    {
        $user = User::query()->orderBy('id')->first();

        if (! $user) {
            $this->error('Create at least one user first.');

            return self::FAILURE;
        }

        if (config('app.timezone') === 'UTC') {
            $this->warn('APP_TIMEZONE is UTC. Daily and monthly limits reset at UTC midnight. Set APP_TIMEZONE=Africa/Cairo in .env.');
        }

        DB::beginTransaction();

        try {
            $this->walletScenarios($ledger, $user);
            $this->damagedScenarios($damaged, $user);
        } catch (\Throwable $exception) {
            $this->failures++;
            $this->error('Unexpected '.get_class($exception).': '.$exception->getMessage());
        } finally {
            DB::rollBack();
        }

        $this->newLine();
        $this->line("{$this->checks} checks, {$this->failures} failed. Nothing was saved.");

        if ($this->failures > 0) {
            $this->error('Do NOT use the wallet module until these failures are explained.');

            return self::FAILURE;
        }

        $this->info('All checks passed.');

        return self::SUCCESS;
    }

    private function walletScenarios(WalletLedgerService $ledger, User $user): void
    {
        $this->line('Wallet ledger');

        $wallet = new Wallet();
        $wallet->fill([
            'name' => 'SELFTEST',
            'provider' => 'other',
            'identifier' => '010'.str_pad((string) random_int(0, 99999999), 8, '0', STR_PAD_LEFT),
            'per_transaction_limit' => 3000,
            'daily_send_limit' => 5000,
            'monthly_send_limit' => 20000,
            'warn_at_percent' => 80,
            'is_active' => true,
        ]);
        $wallet->forceFill(['opening_balance' => '10000.00', 'balance' => '10000.00'])->save();

        // Every field is optional and the same name / number may be used twice.
        $twin = new Wallet();
        $twin->fill(['name' => $wallet->name, 'provider' => $wallet->provider, 'identifier' => $wallet->identifier]);
        $twin->forceFill(['opening_balance' => '0.00', 'balance' => '0.00'])->save();
        $blank = new Wallet();
        $blank->forceFill(['opening_balance' => '0.00', 'balance' => '0.00'])->save();
        $this->check('two wallets can share the same name and number', $twin->exists && $twin->id !== $wallet->id);
        $this->check('a wallet with every optional field empty can be saved', $blank->exists && $blank->label() === 'محفظة #'.$blank->id, $blank->label());

        $base = ['wallet_id' => $wallet->id, 'counterparty' => '01012345678'];
        $balance = fn () => $wallet->fresh()->balance;

        // 1. send with commission and provider fee
        $send = $ledger->record($base + ['type' => 'send', 'amount' => '1000', 'commission' => '10', 'fee' => '2', 'idempotency_key' => 'selftest-send-0000001'], $user);
        $this->check('send: balance drops by amount + fee', $balance() === '8998.00', $balance());
        $this->check('send: cash in = amount + commission', $send->cash_delta === '1010.00', $send->cash_delta);
        $this->check('send: profit = commission - fee', $send->profit === '8.00', $send->profit);

        // 2. receive (cash-out)
        $receive = $ledger->record($base + ['type' => 'receive', 'amount' => '2000', 'commission' => '20'], $user);
        $this->check('receive: balance grows by amount', $balance() === '10998.00', $balance());
        $this->check('receive: cash out = amount - commission', $receive->cash_delta === '-1980.00', $receive->cash_delta);

        // 3. idempotency
        $replay = $ledger->record($base + ['type' => 'send', 'amount' => '1000', 'commission' => '10', 'fee' => '2', 'idempotency_key' => 'selftest-send-0000001'], $user);
        $this->check('same idempotency key returns the first transaction', $replay->id === $send->id && $balance() === '10998.00');

        // 4. limits
        $this->check('per-transaction limit blocks 3500', $this->blocked(fn () => $ledger->record($base + ['type' => 'send', 'amount' => '3500'], $user)));
        $big = $ledger->record($base + ['type' => 'send', 'amount' => '3000'], $user);
        $this->check('daily usage counts sends only', $ledger->usageFor($wallet)['sent_day'] === 400000, (string) $ledger->usageFor($wallet)['sent_day']);
        $this->check('daily send limit blocks the next 1500', $this->blocked(fn () => $ledger->record($base + ['type' => 'send', 'amount' => '1500'], $user)));

        // 5. reversal frees the limit and restores the balance
        $ledger->reverse($big, 'selftest', $user);
        $this->check('reverse restores the balance', $balance() === '10998.00', $balance());
        $this->check('reverse frees the daily limit', $ledger->usageFor($wallet)['sent_day'] === 100000, (string) $ledger->usageFor($wallet)['sent_day']);
        $this->check('a transaction cannot be reversed twice', $this->blocked(fn () => $ledger->reverse($big, 'again', $user)));

        // 6. deferred transfer and partial collection
        $deferred = $ledger->record($base + ['type' => 'send', 'amount' => '500', 'commission' => '5', 'payment_method' => 'deferred', 'customer_name' => 'عميل تجريبي'], $user);
        $this->check('deferred: no cash now, debt = amount + commission', $deferred->cash_delta === '0.00' && $deferred->receivable === '505.00');
        $this->check('deferred without customer name is blocked', $this->blocked(fn () => $ledger->record($base + ['type' => 'send', 'amount' => '10', 'payment_method' => 'deferred'], $user)));
        $ledger->settle($deferred, '200', $user);
        $this->check('partial collection leaves 305.00', $deferred->fresh()->receivable === '305.00', $deferred->fresh()->receivable);
        $this->check('collecting more than owed is blocked', $this->blocked(fn () => $ledger->settle($deferred, '9999', $user)));
        $ledger->settle($deferred, null, $user);
        $this->check('full collection closes the debt', $deferred->fresh()->receivable === '0.00' && $deferred->fresh()->settled_at !== null);
        $this->check('a collected transaction cannot be reversed', $this->blocked(fn () => $ledger->reverse($deferred, 'x', $user)));

        // 6b. replay protection
        $this->check('a replayed key with a different amount is refused', $this->blocked(fn () => $ledger->record($base + ['type' => 'send', 'amount' => '999', 'idempotency_key' => 'selftest-send-0000001'], $user)));

        // 6c. commission is profit: it never touches the wallet balance and never changes working capital
        $capital = fn () => $ledger->workingCapital();
        $profit = fn () => $ledger->profitAvailable();

        [$capital0, $profit0, $balance0] = [$capital(), $profit(), Money::cents($balance())];
        $ledger->record($base + ['type' => 'send', 'amount' => '100', 'commission' => '3', 'fee' => '1', 'idempotency_key' => 'selftest-send-0000002'], $user);
        $this->check('send: wallet drops by amount + fee only (commission is not in the wallet)', Money::cents($balance()) === $balance0 - 10100, $balance());
        $this->check('send: profit grows by commission - fee (+2.00)', $profit() - $profit0 === 200, (string) ($profit() - $profit0));
        $this->check('send: working capital does not change', $capital() === $capital0);

        [$capital0, $profit0, $balance0] = [$capital(), $profit(), Money::cents($balance())];
        $ledger->record($base + ['type' => 'receive', 'amount' => '200', 'commission' => '4'], $user);
        $this->check('receive: wallet gets the full amount, profit grows by the commission (+4.00)', Money::cents($balance()) === $balance0 + 20000 && $profit() - $profit0 === 400);
        $this->check('receive: working capital does not change', $capital() === $capital0);

        $capital0 = $capital();
        $debt = $ledger->record($base + ['type' => 'send', 'amount' => '50', 'commission' => '1', 'payment_method' => 'deferred', 'customer_name' => 'عميل'], $user);
        $this->check('deferred send: working capital does not change', $capital() === $capital0);
        $ledger->settle($debt, null, $user);
        $this->check('collecting the debt: working capital does not change', $capital() === $capital0);

        // 6d. profit withdrawal
        $this->check('withdrawing more than the available profit is blocked', $this->blocked(fn () => $ledger->withdrawProfit('99999999', $wallet->id, 'selftest', $user)));
        if ($profit() >= 100) {
            [$capital0, $profit0, $balance0] = [$capital(), $profit(), Money::cents($balance())];
            $ledger->withdrawProfit('1.00', $wallet->id, 'selftest', $user);
            $this->check('profit withdrawal lowers the available profit and the wallet by 1.00', $profit() === $profit0 - 100 && Money::cents($balance()) === $balance0 - 100);
            $this->check('profit withdrawal does not change working capital', $capital() === $capital0);
        } else {
            $this->warn('  skipped: not enough available profit to test a withdrawal');
        }

        // 7. balance can never go negative
        $left = Money::cents($balance());
        $ledger->adjust($wallet, Money::decimal(-($left - 5000)), 'selftest', $user);
        $this->check('adjustment lowers the balance to 50.00', $balance() === '50.00', $balance());
        $this->check('sending more than the balance is blocked', $this->blocked(fn () => $ledger->record($base + ['type' => 'send', 'amount' => '100'], $user)));

        // 8. immutability
        $this->check('ledger rows cannot be edited', $this->throws(LogicException::class, fn () => $send->fresh()->forceFill(['amount' => '1.00'])->save()));
        $this->check('ledger rows cannot be deleted', $this->throws(LogicException::class, fn () => $send->fresh()->delete()));

        // 8b. phone numbers: any real phone number is accepted, junk is refused
        $this->check('a pasted number with invisible marks and separators is cleaned', Digits::identifier("\u{202A}+20 101-234 5678\u{202C}") === '+201012345678', Digits::identifier("\u{202A}+20 101-234 5678\u{202C}"));
        foreach (['0402345678', '+201012345678', '00201012345678', '01112345678', 'name@instapay'] as $number) {
            $accepted = ! $this->blocked(fn () => $ledger->record($base + ['type' => 'receive', 'amount' => '1', 'counterparty' => $number], $user));
            $this->check("number {$number} is accepted", $accepted);
        }
        foreach (['12345', 'abc123', '+', '1234567890123456', '010abc4567'] as $junk) {
            $this->check("number {$junk} is refused", $this->blocked(fn () => $ledger->record($base + ['type' => 'receive', 'amount' => '1', 'counterparty' => $junk], $user)));
        }
        $this->check('sending to the wallet\'s own number is refused', $this->blocked(fn () => $ledger->record($base + ['type' => 'receive', 'amount' => '1', 'counterparty' => $wallet->identifier], $user)));

        // 9. the books balance
        $ledgerBalance = Money::cents($wallet->opening_balance) + Money::cents(WalletTransaction::query()->where('wallet_id', $wallet->id)->sum('wallet_delta'));
        $this->check('wallet balance = opening balance + ledger', $ledgerBalance === Money::cents($balance()), Money::decimal($ledgerBalance).' vs '.$balance());
    }

    private function damagedScenarios(DamagedStockService $damaged, User $user): void
    {
        $this->newLine();
        $this->line('Damaged stock (هالِك)');

        $product = products::query()->where('stock', '>=', 2)->first();

        if (! $product) {
            $this->warn('  skipped: no product with stock >= 2');

            return;
        }

        $stock = (int) $product->stock;
        $sold = (int) $product->total_sold;
        $data = ['product_id' => $product->id, 'quantity' => 2, 'reason' => 'broken', 'damaged_on' => now()->toDateString(), 'idempotency_key' => 'selftest-damaged-000001'];

        $item = $damaged->record($data, $user);
        $this->check('damage subtracts the quantity from stock', (int) $product->fresh()->stock === $stock - 2, (string) $product->fresh()->stock);
        $this->check('damage does not count as a sale', (int) $product->fresh()->total_sold === $sold);
        $this->check('same idempotency key does not subtract twice', $damaged->record($data, $user)->id === $item->id && (int) $product->fresh()->stock === $stock - 2);
        $this->check('quantity above stock is blocked', $this->blocked(fn () => $damaged->record(['quantity' => $stock + 1, 'idempotency_key' => 'selftest-damaged-000002'] + $data, $user)));

        $damaged->void($item, 'selftest', $user);
        $this->check('voiding returns the stock', (int) $product->fresh()->stock === $stock, (string) $product->fresh()->stock);
        $this->check('a record cannot be voided twice', $this->blocked(fn () => $damaged->void($item, 'again', $user)));
        $this->check('damaged records cannot be edited', $this->throws(LogicException::class, fn () => DamagedItem::query()->find($item->id)->forceFill(['quantity' => 99])->save()));
    }

    private function check(string $name, bool $ok, string $detail = ''): void
    {
        $this->checks++;

        if ($ok) {
            $this->line('  <info>PASS</info> '.$name);

            return;
        }

        $this->failures++;
        $this->line('  <error>FAIL</error> '.$name.($detail !== '' ? " [{$detail}]" : ''));
    }

    private function blocked(callable $callback): bool
    {
        return $this->throws(ValidationException::class, $callback);
    }

    private function throws(string $class, callable $callback): bool
    {
        try {
            $callback();
        } catch (\Throwable $exception) {
            return $exception instanceof $class;
        }

        return false;
    }
}
