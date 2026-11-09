<?php

namespace App\Console\Commands;

use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Support\Money;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class ReconcileWallets extends Command
{
    protected $signature = 'wallets:reconcile';

    protected $description = 'Check that every wallet balance equals its opening balance plus its ledger (exit code 1 on mismatch)';

    public function handle(): int
    {
        $rows = [];
        $bad = 0;

        foreach (Wallet::query()->orderBy('id')->get() as $wallet) {
            $ledger = Money::cents($wallet->opening_balance)
                + Money::cents(WalletTransaction::query()->where('wallet_id', $wallet->id)->sum('wallet_delta'));
            $stored = Money::cents($wallet->balance);
            $ok = $ledger === $stored;
            $bad += $ok ? 0 : 1;

            $rows[] = [$wallet->id, $wallet->label(), Money::format($stored), Money::format($ledger), $ok ? 'OK' : 'MISMATCH'];
        }

        $this->table(['ID', 'Wallet', 'Stored balance', 'Ledger balance', 'Result'], $rows);

        if ($bad > 0) {
            Log::critical("wallets:reconcile found {$bad} wallet(s) whose balance differs from the ledger.");
            $this->error("{$bad} wallet(s) do not match their ledger. Do not trade until this is investigated.");

            return self::FAILURE;
        }

        $this->info('All wallet balances match the ledger.');

        return self::SUCCESS;
    }
}
