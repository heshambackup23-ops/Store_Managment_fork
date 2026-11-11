<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->addIndex('products', ['category_id'], 'products_category_id_index');
        $this->addIndex('products', ['stock'], 'products_stock_index');
        $this->addIndex('products', ['total_sold'], 'products_total_sold_index');
        $this->addIndex('invoices', ['invoice_date'], 'invoices_invoice_date_index');
        $this->addIndex('invoices', ['status'], 'invoices_status_index');
        $this->addIndex('suppliers', ['balance'], 'suppliers_balance_index');
    }

    public function down(): void
    {
        $this->dropIndex('products', 'products_category_id_index');
        $this->dropIndex('products', 'products_stock_index');
        $this->dropIndex('products', 'products_total_sold_index');
        $this->dropIndex('invoices', 'invoices_invoice_date_index');
        $this->dropIndex('invoices', 'invoices_status_index');
        $this->dropIndex('suppliers', 'suppliers_balance_index');
    }

    /** @param list<string> $columns */
    private function addIndex(string $tableName, array $columns, string $indexName): void
    {
        if (Schema::hasTable($tableName) && ! Schema::hasIndex($tableName, $indexName)) {
            Schema::table($tableName, fn (Blueprint $table) => $table->index($columns, $indexName));
        }
    }

    private function dropIndex(string $tableName, string $indexName): void
    {
        if (Schema::hasTable($tableName) && Schema::hasIndex($tableName, $indexName)) {
            Schema::table($tableName, fn (Blueprint $table) => $table->dropIndex($indexName));
        }
    }
};
