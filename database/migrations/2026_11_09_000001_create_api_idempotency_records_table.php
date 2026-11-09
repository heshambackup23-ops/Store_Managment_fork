<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('api_idempotency_records', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('operation', 80);
            $table->string('idempotency_key', 64);
            $table->char('request_hash', 64);
            $table->unsignedSmallInteger('response_status')->nullable();
            $table->json('response_body')->nullable();
            $table->timestamps();

            $table->unique(
                ['user_id', 'operation', 'idempotency_key'],
                'api_idempotency_user_operation_key_unique'
            );
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        if (Schema::hasTable('api_idempotency_records') && DB::table('api_idempotency_records')->exists()) {
            throw new RuntimeException('Rollback refused: API idempotency records are required to prevent duplicate operations.');
        }

        Schema::dropIfExists('api_idempotency_records');
    }
};
