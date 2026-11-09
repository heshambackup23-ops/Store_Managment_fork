<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * 1. A covering index for the limit-usage query (the hottest query in the module).
 * 2. CHECK constraints, so even a raw SQL mistake can not store a negative balance
 *    or a negative amount. MySQL 8.0.16+ and MariaDB enforce them; on older servers
 *    this step is skipped and logged, nothing else changes.
 */
return new class extends Migration
{
    private const USAGE_INDEX = 'wt_usage_idx';

    private const CHECKS = [
        ['wallets', 'wallets_balance_non_negative', 'balance >= 0'],
        ['wallet_transactions', 'wt_amounts_non_negative', 'amount >= 0 AND commission >= 0 AND fee >= 0 AND receivable >= 0'],
    ];

    public function up(): void
    {
        if (Schema::hasTable('wallet_transactions') && ! $this->hasIndex('wallet_transactions', self::USAGE_INDEX)) {
            Schema::table('wallet_transactions', function (Blueprint $table): void {
                $table->index(['wallet_id', 'status', 'occurred_at', 'type'], self::USAGE_INDEX);
            });
        }

        if (! in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            return;
        }

        foreach (self::CHECKS as [$table, $name, $expression]) {
            if (! Schema::hasTable($table) || $this->hasConstraint($table, $name)) {
                continue;
            }

            try {
                DB::statement("ALTER TABLE `{$table}` ADD CONSTRAINT `{$name}` CHECK ({$expression})");
            } catch (\Throwable $exception) {
                // Old server or existing rows that break the rule: report it, never block the migration.
                Log::warning("Could not add CHECK constraint {$name} on {$table}: ".$exception->getMessage());
            }
        }
    }

    public function down(): void
    {
        foreach (self::CHECKS as [$table, $name]) {
            if (Schema::hasTable($table) && $this->hasConstraint($table, $name)) {
                try {
                    DB::statement("ALTER TABLE `{$table}` DROP CONSTRAINT `{$name}`");
                } catch (\Throwable) {
                    DB::statement("ALTER TABLE `{$table}` DROP CHECK `{$name}`");
                }
            }
        }

        if (Schema::hasTable('wallet_transactions') && $this->hasIndex('wallet_transactions', self::USAGE_INDEX)) {
            Schema::table('wallet_transactions', fn (Blueprint $table) => $table->dropIndex(self::USAGE_INDEX));
        }
    }

    private function hasIndex(string $table, string $name): bool
    {
        return collect(Schema::getIndexes($table))->contains(fn (array $index) => ($index['name'] ?? '') === $name);
    }

    private function hasConstraint(string $table, string $name): bool
    {
        return DB::table('information_schema.table_constraints')
            ->where('constraint_schema', DB::raw('DATABASE()'))
            ->where('table_name', $table)
            ->where('constraint_name', $name)
            ->exists();
    }
};
