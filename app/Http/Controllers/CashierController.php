<?php

namespace App\Http\Controllers;

use App\Http\Requests\CashierCheckoutRequest;
use App\Models\invoice;
use App\Models\products;
use App\Services\InvoiceCreationService;
use App\Services\InvoiceInstallmentSync;
use App\Services\PictureStorageService;
use Illuminate\Contracts\View\View;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Point-of-sale screen.
 *
 * The cashier does NOT own any sales tables. Every sale is created through the
 * existing InvoiceCreationService, so stock locking, invoice numbers,
 * notifications, installments/debts, refunds and printing all keep working
 * exactly as they do for invoices created from the invoice form.
 */
class CashierController extends Controller
{
    private const WALK_IN_CUSTOMER = 'زبون نقدي';

    private const SEARCH_LIMIT = 20;

    private const TOP_SELLERS_LIMIT = 12;

    private const IDEMPOTENCY_MINUTES = 10;

    /** Folder name PictureStorageService uses for old-style product pictures. */
    private const PRODUCT_PICTURE_FOLDER = 'products';

    public function __construct(private readonly PictureStorageService $pictures)
    {
    }

    public function index(): View
    {
        return view('cashier.index');
    }

    /**
     * JSON product lookup by name or barcode (small result set, never the full table).
     */
    public function search(Request $request): JsonResponse
    {
        $validated = $request->validate(['q' => ['nullable', 'string', 'max:100']]);
        $term = trim((string) ($validated['q'] ?? ''));

        // No query: show best sellers that are in stock, for one-tap selling.
        if ($term === '') {
            $items = products::query()
                ->where('stock', '>', 0)
                ->orderByDesc('total_sold')
                ->orderBy('name')
                ->limit(self::TOP_SELLERS_LIMIT)
                ->get(['id', 'name', 'price', 'barcode', 'stock', 'image']);

            return $this->searchResponse($items, false);
        }

        // Exact barcode match (a scanner types the code and presses Enter).
        $exact = products::query()->where('barcode', $term)
            ->first(['id', 'name', 'price', 'barcode', 'stock', 'image']);

        if ($exact) {
            return $this->searchResponse(collect([$exact]), true);
        }

        // Every word must match the name or the barcode, in any order.
        $words = array_slice(preg_split('/\s+/u', $term, -1, PREG_SPLIT_NO_EMPTY) ?: [], 0, 5);
        $query = products::query();

        foreach ($words as $word) {
            $like = '%'.$this->escapeLike($word).'%';
            $query->where(fn ($q) => $q->where('name', 'like', $like)->orWhere('barcode', 'like', $like));
        }

        // Rank: names starting with the query first, then in-stock before out-of-stock.
        $items = $query
            ->orderByRaw('CASE WHEN name LIKE ? THEN 0 ELSE 1 END, stock = 0, name', [$this->escapeLike($term).'%'])
            ->limit(self::SEARCH_LIMIT)
            ->get(['id', 'name', 'price', 'barcode', 'stock', 'image']);

        return $this->searchResponse($items, false);
    }

    /**
     * Complete a sale. Safe to retry: the same token never creates two invoices.
     */
    public function checkout(
        CashierCheckoutRequest $request,
        InvoiceCreationService $service,
        InvoiceInstallmentSync $installments
    ): JsonResponse {
        $data = $request->validated();
        $userId = (int) $request->user()->id;

        // Merge duplicate product lines.
        $lines = [];
        foreach ($data['items'] as $item) {
            $productId = (int) $item['product_id'];
            $lines[$productId] = ($lines[$productId] ?? 0) + (int) $item['quantity'];
        }

        // Prices come from the database, never from the browser.
        $prices = products::query()->whereIn('id', array_keys($lines))->pluck('price', 'id');

        if ($prices->count() !== count($lines)) {
            return $this->fail('منتج في السلة لم يعد موجوداً. أزله ثم حاول مرة أخرى.', 422);
        }

        $totalCents = 0;
        foreach ($lines as $productId => $quantity) {
            $totalCents += (int) round(((float) $prices[$productId]) * 100) * $quantity;
        }

        // Empty "received" means exact full payment. Overpayment becomes change.
        $receivedCents = isset($data['received'])
            ? (int) round(((float) $data['received']) * 100)
            : $totalCents;
        $paidCents = min($receivedCents, $totalCents);

        $customer = trim((string) preg_replace('/\s+/u', ' ', (string) ($data['customer'] ?? '')));

        // A partial payment creates a debt, which needs a named customer.
        if ($paidCents < $totalCents && $customer === '') {
            return $this->fail('عند الدفع الجزئي لازم تكتب اسم العميل لتسجيل المتبقي كدين.', 422, [
                'customer' => ['اسم العميل مطلوب عند الدفع الجزئي.'],
            ]);
        }

        if ($customer === '') {
            $customer = self::WALK_IN_CUSTOMER;
        }

        // Idempotency: a retry or double-click with the same token returns the first result.
        $cacheKey = sprintf('cashier:checkout:%d:%s', $userId, $data['token']);

        if (! Cache::add($cacheKey, ['status' => 'processing'], now()->addMinutes(self::IDEMPOTENCY_MINUTES))) {
            $previous = Cache::get($cacheKey);

            if (is_array($previous) && ($previous['status'] ?? null) === 'done') {
                return response()->json($previous['response']);
            }

            return $this->fail('هذه العملية قيد التنفيذ. انتظر لحظة ثم حاول مرة أخرى.', 409);
        }

        try {
            $invoice = $service->create(
                [
                    'customer' => $customer,
                    'product_ids' => array_keys($lines),
                    'quantities' => array_values($lines),
                    'invoice_date' => now()->toDateString(),
                    'paid_amount' => $this->money($paidCents),
                ],
                $userId,
                fn (invoice $invoice, array $items, float $total, float $paid) =>
                    $installments->sync($invoice, $items, $total, $paid)
            );
        } catch (ValidationException $exception) {
            Cache::forget($cacheKey); // let the cashier fix the cart and retry
            throw ValidationException::withMessages($this->translateErrors($exception->errors()));
        } catch (Throwable $exception) {
            Cache::forget($cacheKey);
            report($exception);

            return $this->fail('تعذر إتمام العملية ولم يتم حفظ أي شيء. حاول مرة أخرى.', 500);
        }

        $invoiceTotalCents = (int) round(((float) $invoice->total_amount) * 100);
        $invoicePaidCents = (int) round(((float) $invoice->paid_amount) * 100);

        $response = [
            'ok' => true,
            'invoice_id' => $invoice->id,
            'invoice_number' => $invoice->invoice_number,
            'total' => $this->money($invoiceTotalCents),
            'paid' => $this->money($invoicePaidCents),
            'remaining' => $this->money(max(0, $invoiceTotalCents - $invoicePaidCents)),
            'change' => $this->money(max(0, $receivedCents - $invoicePaidCents)),
            'print_url' => route('invoices.print', $invoice),
        ];

        Cache::put($cacheKey, ['status' => 'done', 'response' => $response], now()->addMinutes(self::IDEMPOTENCY_MINUTES));

        return response()->json($response);
    }

    private function searchResponse(Collection $items, bool $exact): JsonResponse
    {
        return response()->json([
            'exact' => $exact,
            'data' => $items->map(fn (products $product) => [
                'id' => $product->id,
                'name' => $product->name,
                'price' => $this->money((int) round(((float) $product->price) * 100)),
                'barcode' => $product->barcode,
                'stock' => (int) $product->stock,
                'image_url' => $this->pictures->productUrl($product, true),
            ])->values(),
        ]);
    }

    /**
     * InvoiceCreationService throws English messages. The cashier is Arabic,
     * so the known ones are translated here without touching the service.
     *
     * @param  array<string, array<int, string>>  $errors
     * @return array<string, array<int, string>>
     */
    private function translateErrors(array $errors): array
    {
        $translated = [];

        foreach ($errors as $field => $messages) {
            foreach ($messages as $message) {
                if (preg_match('/^Insufficient stock for (.+)\.$/u', $message, $match)) {
                    $translated[$field][] = 'المخزون غير كافٍ للمنتج: '.$match[1].'.';
                } elseif (str_contains($message, 'no longer available')) {
                    $translated[$field][] = 'منتج في السلة لم يعد متاحاً. أزله ثم حاول مرة أخرى.';
                } elseif (str_contains($message, 'payment cannot exceed')) {
                    $translated[$field][] = 'المبلغ المدفوع أكبر من إجمالي الفاتورة.';
                } else {
                    $translated[$field][] = $message;
                }
            }
        }

        return $translated;
    }

    private function escapeLike(string $value): string
    {
        return addcslashes($value, '%_\\');
    }

    private function money(int $cents): string
    {
        return number_format($cents / 100, 2, '.', '');
    }

    private function fail(string $message, int $status, array $errors = []): JsonResponse
    {
        return response()->json(['ok' => false, 'message' => $message, 'errors' => $errors], $status);
    }
}
