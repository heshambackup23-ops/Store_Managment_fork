<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('personal_debts', function (Blueprint $table): void {
            $table->id();
            $table->string('creditor', 255);
            $table->string('description', 255)->nullable();
            $table->decimal('total_amount', 12, 2);
            $table->decimal('paid_amount', 12, 2)->default(0);
            $table->decimal('remaining', 12, 2);
            $table->date('due_date')->nullable();
            $table->string('status', 20)->default('open');
            $table->text('notes')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['status', 'due_date']);
        });

        Schema::create('personal_debt_payments', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('personal_debt_id')->constrained('personal_debts')->restrictOnDelete();
            $table->decimal('amount', 12, 2);
            $table->date('paid_on');
            $table->string('notes', 500)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->index(['personal_debt_id', 'paid_on']);
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('personal_debt_payments') && Schema::hasTable('personal_debts')) {
            if (DB::table('personal_debt_payments')->exists() || DB::table('personal_debts')->exists()) {
                throw new RuntimeException('Rollback refused: personal-debt records exist.');
            }
        }

        Schema::dropIfExists('personal_debt_payments');
        Schema::dropIfExists('personal_debts');
    }
};
