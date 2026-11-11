<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table): void {
            $table->string('address')->nullable()->change();
        });

        Schema::table('products', function (Blueprint $table): void {
            $table->text('description')->nullable()->change();
        });

        Schema::table('maintenances', function (Blueprint $table): void {
            $table->string('address')->nullable()->change();
            $table->text('description')->nullable()->change();
        });
    }

    public function down(): void
    {
        DB::table('customers')->whereNull('address')->update(['address' => '']);
        DB::table('products')->whereNull('description')->update(['description' => '']);
        DB::table('maintenances')->whereNull('address')->update(['address' => '']);
        DB::table('maintenances')->whereNull('description')->update(['description' => '']);

        Schema::table('customers', function (Blueprint $table): void {
            $table->string('address')->nullable(false)->change();
        });

        Schema::table('products', function (Blueprint $table): void {
            $table->text('description')->nullable(false)->change();
        });

        Schema::table('maintenances', function (Blueprint $table): void {
            $table->string('address')->nullable(false)->change();
            $table->text('description')->nullable(false)->change();
        });
    }
};
