<?php

namespace App\Http\Controllers;

use App\Models\customers;
use App\Models\installments;
use App\Models\invoice;
use App\Models\Maintenance;
use App\Models\products;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;
use ZipArchive;

/**
 * Data export (CSV zip, Excel, PDF).
 *
 * This is an EXPORT for reading and archiving, not a restorable database backup.
 * For a real backup use mysqldump (see the backup script in the Windows scripts).
 *
 * Fixed here: errors were swallowed by empty catch blocks (the export then failed
 * silently), the PhpSpreadsheet calls used a removed API, spreadsheet formulas in
 * user text were not neutralised, invoice line items were missing, CSV had no BOM
 * (Arabic looked broken in Excel), and the wallet / damaged-stock tables were absent.
 */
class BackupController extends Controller
{
    /** Stable backup page keys mapped to real database tables. System queues, sessions,
     * tokens, and migration bookkeeping are deliberately excluded. */
    private const BACKUP_GROUPS = [
        'catalog' => ['categories', 'products'],
        'customers' => ['customers'],
        'sales' => ['sales', 'sales_items', 'payments'],
        'invoices' => ['invoices'],
        'installments' => ['installments', 'debts', 'personal_debts', 'personal_debt_payments'],
        'suppliers' => ['suppliers', 'supplier_payments', 'purchases'],
        'maintenance' => ['maintenances'],
        'wallets' => ['wallets', 'wallet_transactions', 'wallet_expenses', 'wallet_cash_adjustments', 'wallet_audit_logs'],
        'damaged' => ['damaged_items'],
        'notifications' => ['app_notifications', 'notification_reads'],
        'team' => ['users', 'profiles', 'settings', 'roles', 'permissions', 'model_has_permissions', 'model_has_roles', 'role_has_permissions'],
    ];

    /** Stream a versioned, restorable NDJSON snapshot. Rows are emitted in bounded chunks. */
    public function apiExport(Request $request): StreamedResponse
    {
        $validated = $request->validate(['pages' => ['nullable', 'array', 'min:1'], 'pages.*' => ['required', 'string', 'in:'.implode(',', array_keys(self::BACKUP_GROUPS))]]);
        $pages = array_values(array_unique($validated['pages'] ?? array_keys(self::BACKUP_GROUPS)));
        $tables = $this->tablesForPages($pages);
        $filename = 'store-backup-'.now()->format('Ymd-His').'.json';

        return response()->streamDownload(function () use ($pages, $tables): void {
            $out = fopen('php://output', 'w');
            fwrite($out, json_encode(['format' => 'store-management-backup-ndjson', 'version' => 1, 'created_at' => now()->toIso8601String(), 'pages' => $pages], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n");
            foreach ($tables as $table) {
                DB::table($table)->orderBy(Schema::getColumnListing($table)[0] ?? 'id')->chunk(500, function ($rows) use ($out, $table): void {
                    foreach ($rows as $row) {
                        fwrite($out, json_encode(['table' => $table, 'row' => (array) $row], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n");
                    }
                });
            }
            fclose($out);
        }, str_replace('.json', '.jsonl', $filename), ['Content-Type' => 'application/x-ndjson; charset=utf-8', 'Cache-Control' => 'no-store']);
    }

    /** Read rows incrementally; any invalid row rolls the complete transaction back. */
    public function apiImport(Request $request): JsonResponse
    {
        $validated = $request->validate(['file' => ['required', 'file', 'max:512000', 'mimetypes:application/json,text/plain'], 'pages' => ['required', 'string', 'max:1000']]);
        $pages = $this->decodeBackupLine($validated['pages']);
        Validator::make(['pages' => $pages], ['pages' => ['required', 'array', 'min:1'], 'pages.*' => ['required', 'string', 'in:'.implode(',', array_keys(self::BACKUP_GROUPS))]])->validate();
        $pages = array_values(array_unique($pages));
        $allowed = $this->tablesForPages($pages);
        $handle = fopen($validated['file']->getRealPath(), 'r');
        abort_if($handle === false, 422, 'Unable to read backup file.');
        $importedTables = [];
        try {
            $header = $this->decodeBackupLine((string) fgets($handle));
            abort_unless(is_array($header) && ($header['format'] ?? null) === 'store-management-backup-ndjson' && ($header['version'] ?? null) === 1, 422, 'Unsupported or invalid backup file.');
            DB::transaction(function () use ($handle, $allowed, &$importedTables): void {
                $columnsByTable = [];
                while (($line = fgets($handle)) !== false) {
                    if (trim($line) === '') continue;
                    $record = $this->decodeBackupLine($line);
                    $table = $record['table'] ?? null;
                    $row = $record['row'] ?? null;
                    abort_unless(is_string($table) && in_array($table, $allowed, true) && is_array($row), 422, 'Invalid backup row.');
                    $columns = $columnsByTable[$table] ??= Schema::getColumnListing($table);
                    abort_unless(count(array_intersect(array_keys($row), $columns)) === count($row), 422, 'Invalid row data in backup.');
                    $row = array_intersect_key($row, array_flip($columns));
                    $keys = array_intersect(['id', 'uuid'], array_keys($row));
                    if ($keys !== []) {
                        $key = reset($keys);
                        DB::table($table)->updateOrInsert([$key => $row[$key]], $row);
                    } else {
                        DB::table($table)->insertOrIgnore($row);
                    }
                    $importedTables[$table] = true;
                }
            }, 3);
        } finally { fclose($handle); }

        return response()->json(['data' => ['imported_tables' => array_keys($importedTables), 'message' => 'Backup data merged successfully.']]);
    }

    /** @param list<string> $pages @return list<string> */
    private function tablesForPages(array $pages): array
    {
        $tables = [];
        foreach ($pages as $page) foreach (self::BACKUP_GROUPS[$page] ?? [] as $table) {
            if (Schema::hasTable($table)) $tables[] = $table;
        }
        return array_values(array_unique($tables));
    }

    private function decodeBackupLine(string $line): mixed
    {
        try {
            return json_decode($line, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw ValidationException::withMessages(['file' => 'The selected backup file contains invalid JSON.']);
        }
    }

    public function webImport(Request $request): JsonResponse
    {
        abort_unless($request->user()?->can('page.backup.manage'), 403);
        $request->merge(['pages' => json_encode($request->input('pages', []), JSON_THROW_ON_ERROR)]);
        return $this->apiImport($request);
    }

    public function export(Request $request)
    {
        $user = $request->user();
        abort_unless($user?->can('page.backup.view') || $user?->can('page.backup.manage'), 403);

        $validated = $request->validate(['format' => ['nullable', 'in:zip,pdf,xlsx,excel,csv,jsonl']]);
        $format = $validated['format'] ?? 'zip';
        if ($format === 'jsonl') {
            abort_unless($request->user()?->can('page.backup.manage'), 403);
            return $this->apiExport($request);
        }
        $name = 'backup-'.now()->format('YmdHis');

        try {
            $datasets = $this->datasets();

            return match ($format) {
                'pdf' => $this->pdf($request, $datasets, $name),
                'xlsx', 'excel' => $this->xlsx($datasets, $name),
                default => $this->zip($datasets, $name),
            };
        } catch (HttpException $exception) {
            throw $exception;
        } catch (Throwable $exception) {
            report($exception);

            return $this->failure($request, 'تعذر إنشاء ملف التصدير.', 500);
        }
    }

    /** @return array<string, callable(): iterable<array<string, mixed>>> */
    private function datasets(): array
    {
        $sets = [
            'products' => fn () => $this->models(products::with('category'), fn ($p) => [
                'id' => $p->id, 'name' => $p->name, 'price' => $p->price, 'description' => $p->description,
                'barcode' => $p->barcode, 'stock' => $p->stock, 'total_sold' => $p->total_sold,
                'category' => $p->category?->name, 'image' => $p->image,
                'created_at' => $p->created_at, 'updated_at' => $p->updated_at,
            ]),
            'invoices' => fn () => $this->models(invoice::with('product'), fn ($i) => [
                'id' => $i->id, 'invoice_number' => $i->invoice_number, 'customer' => $i->customer,
                'product_id' => $i->product_id, 'product_name' => $i->product?->name, 'quantity' => $i->quantity,
                'product_price' => $i->product_price, 'total_amount' => $i->total_amount, 'paid_amount' => $i->paid_amount,
                'status' => $i->status, 'invoice_date' => $i->invoice_date,
                'items' => $i->items, // every line of the invoice, not only the first product
                'created_at' => $i->created_at, 'updated_at' => $i->updated_at,
            ]),
            'installments' => fn () => $this->models(installments::query(), fn ($i) => [
                'id' => $i->id, 'invoice_id' => $i->invoice_id, 'customer' => $i->customer,
                'product_id' => $i->product_id, 'product_name' => $i->product_name, 'product_price' => $i->product_price,
                'quantity' => $i->quantity, 'paid_amount' => $i->paid_amount, 'remaining' => $i->remaining,
                'status' => $i->status, 'payment_date' => $i->payment_date, 'next_payment_date' => $i->next_payment_date,
                'items' => $i->items, 'created_at' => $i->created_at, 'updated_at' => $i->updated_at,
            ]),
            'customers' => fn () => $this->models(customers::query(), fn ($c) => [
                'id' => $c->id, 'name' => $c->name, 'phone' => $c->phone, 'address' => $c->address,
                'created_at' => $c->created_at, 'updated_at' => $c->updated_at,
            ]),
            'maintenance' => fn () => $this->models(Maintenance::query(), fn ($m) => [
                'id' => $m->id, 'name' => $m->name, 'owner' => $m->owner, 'phone' => $m->phone, 'address' => $m->address,
                'description' => $m->description, 'status' => $m->status, 'requested_date' => $m->requested_date,
                'completed_date' => $m->completed_date, 'created_at' => $m->created_at, 'updated_at' => $m->updated_at,
            ]),
        ];

        // Money and stock records added by the wallet and damaged-stock modules (raw database values).
        foreach (['wallets', 'wallet_transactions', 'wallet_expenses', 'wallet_cash_adjustments', 'wallet_audit_logs', 'damaged_items'] as $table) {
            if (Schema::hasTable($table)) {
                $sets[$table] = fn () => $this->table($table);
            }
        }

        return $sets;
    }

    /** Reads in chunks, so a large table never has to fit in memory. */
    private function models($query, callable $map): \Generator
    {
        foreach ($query->lazyById(500) as $model) {
            yield $map($model);
        }
    }

    private function table(string $table): \Generator
    {
        foreach (DB::table($table)->lazyById(500) as $row) {
            yield (array) $row;
        }
    }

    // ------------------------------------------------------------------ formats

    private function zip(array $datasets, string $name)
    {
        if (! class_exists(ZipArchive::class)) {
            abort(500, 'التصدير يتطلب تفعيل إضافة zip في PHP (extension=zip في ملف php.ini).');
        }

        $zipPath = $this->tempPath();
        $temporary = [];
        $zip = new ZipArchive();

        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            @unlink($zipPath);
            abort(500, 'تعذر إنشاء ملف التصدير.');
        }

        try {
            foreach ($datasets as $key => $provider) {
                $csvPath = $this->tempPath();
                $temporary[] = $csvPath;
                $this->writeCsv($csvPath, $provider());
                $zip->addFile($csvPath, $key.'.csv');
            }

            $zip->close();
        } catch (Throwable $exception) {
            @unlink($zipPath);
            throw $exception;
        } finally {
            foreach ($temporary as $path) {
                @unlink($path);
            }
        }

        return response()->download($zipPath, $name.'.zip')->deleteFileAfterSend(true);
    }

    private function xlsx(array $datasets, string $name)
    {
        if (! class_exists(\PhpOffice\PhpSpreadsheet\Spreadsheet::class)) {
            return $this->zip($datasets, $name.'-csv'); // package not installed: fall back to CSV files
        }

        $spreadsheet = new \PhpOffice\PhpSpreadsheet\Spreadsheet();
        $spreadsheet->removeSheetByIndex(0);

        foreach ($datasets as $key => $provider) {
            $sheet = new \PhpOffice\PhpSpreadsheet\Worksheet\Worksheet($spreadsheet, mb_substr(Str::title(str_replace('_', ' ', $key)), 0, 31));
            $spreadsheet->addSheet($sheet);
            $sheet->setRightToLeft(true);

            $rowIndex = 1;
            foreach ($provider() as $row) {
                if ($rowIndex === 1) {
                    $column = 1;
                    foreach (array_keys($row) as $header) {
                        $sheet->setCellValueExplicit([$column++, 1], (string) $header, \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING);
                    }
                    $rowIndex = 2;
                }

                $column = 1;
                foreach ($row as $value) {
                    $value = $this->cell($value);
                    $sheet->setCellValueExplicit(
                        [$column++, $rowIndex],
                        $value,
                        is_string($value) ? \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_STRING : \PhpOffice\PhpSpreadsheet\Cell\DataType::TYPE_NUMERIC
                    );
                }
                $rowIndex++;
            }
        }

        $spreadsheet->setActiveSheetIndex(0);
        $path = $this->tempPath();
        (new \PhpOffice\PhpSpreadsheet\Writer\Xlsx($spreadsheet))->save($path);

        return response()->download($path, $name.'.xlsx')->deleteFileAfterSend(true);
    }

    private function pdf(Request $request, array $datasets, string $name)
    {
        if (! class_exists(\Dompdf\Dompdf::class)) {
            $message = 'توليد PDF يتطلب تثبيت الحزمة dompdf/dompdf.';

            if ($request->expectsJson() || $request->ajax()) {
                return response()->json(['error' => $message], 501);
            }

            return redirect()->back()->with('error', $message);
        }

        $html = '<html dir="rtl"><head><meta charset="utf-8"><style>'
            .'body{font-family:"DejaVu Sans",sans-serif;font-size:9px}table{border-collapse:collapse;width:100%;margin-bottom:12px}'
            .'th,td{border:1px solid #999;padding:3px;word-break:break-all}</style></head><body>'
            .'<h1>Backup export - '.e(now()->toDateTimeString()).'</h1>';

        foreach ($datasets as $key => $provider) {
            $rows = iterator_to_array($provider(), false);
            $html .= '<h2>'.e(Str::title(str_replace('_', ' ', $key))).'</h2>';

            if ($rows === []) {
                $html .= '<p>(لا توجد سجلات)</p>';
                continue;
            }

            $html .= '<table><thead><tr>';
            foreach (array_keys($rows[0]) as $column) {
                $html .= '<th>'.e($column).'</th>';
            }
            $html .= '</tr></thead><tbody>';
            foreach ($rows as $row) {
                $html .= '<tr>';
                foreach ($row as $value) {
                    $html .= '<td>'.e((string) $this->cell($value)).'</td>';
                }
                $html .= '</tr>';
            }
            $html .= '</tbody></table>';
        }

        $dompdf = new \Dompdf\Dompdf();
        $dompdf->loadHtml($html.'</body></html>');
        $dompdf->setPaper('A4', 'landscape');
        $dompdf->render();

        $path = $this->tempPath();
        file_put_contents($path, $dompdf->output());

        return response()->download($path, $name.'.pdf')->deleteFileAfterSend(true);
    }

    // ------------------------------------------------------------------ helpers

    private function writeCsv(string $path, iterable $rows): void
    {
        $handle = fopen($path, 'w');
        fwrite($handle, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel shows Arabic correctly
        $first = true;

        foreach ($rows as $row) {
            if ($first) {
                fputcsv($handle, array_keys($row), ',', '"', '\\');
                $first = false;
            }

            fputcsv($handle, array_map(fn ($value) => $this->cell($value), array_values($row)), ',', '"', '\\');
        }

        fclose($handle);
    }

    /** One safe cell value: dates and arrays become text, formula-looking text is neutralised. */
    private function cell(mixed $value): string|int|float
    {
        if ($value === null) {
            return '';
        }
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d H:i:s');
        }
        if (is_bool($value)) {
            return $value ? 1 : 0;
        }
        if (is_array($value) || is_object($value)) {
            $value = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '';
        }
        if (is_int($value) || is_float($value)) {
            return $value;
        }

        $text = (string) $value;

        // Text typed by users that starts with = + - @ would run as a formula in Excel.
        if ($text !== '' && ! is_numeric($text) && in_array($text[0], ['=', '+', '-', '@', "\t", "\r"], true)) {
            return "'".$text;
        }

        return $text;
    }

    private function tempPath(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'bk_');

        if ($path === false) {
            abort(500, 'تعذر إنشاء ملف مؤقت للتصدير.');
        }

        return $path;
    }

    private function failure(Request $request, string $message, int $status)
    {
        if ($request->expectsJson() || $request->ajax()) {
            return response()->json(['error' => true, 'message' => $message], $status);
        }

        abort($status, $message);
    }
}
