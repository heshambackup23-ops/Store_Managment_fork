<?php

namespace App\Http\Controllers;

use App\Models\AppNotification;
use App\Models\installments;
use App\Models\invoice;
use App\Models\products;
use App\Services\InvoiceCreationService;
use App\Services\InvoiceInstallmentSync;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class InvoiceOperationsController extends Controller
{
    public function index(Request $request)
    {
        $request->validate(['search' => ['nullable', 'string', 'max:80']]);

        $invoices = invoice::with('product')
            ->when($request->filled('search'), function ($query) use ($request): void {
                $search = '%'.$request->string('search')->toString().'%';
                $query->where(fn ($query) => $query
                    ->where('customer', 'like', $search)
                    ->orWhere('invoice_number', 'like', $search));
            })
            ->orderByDesc('id')
            ->paginate(20)
            ->withQueryString();

        return view('invoice.index', compact('invoices'));
    }

    public function create()
    {
        $oldProductIds = old('product_ids', []);
        $products = products::query()->whereIn('id', is_array($oldProductIds) ? $oldProductIds : [])
            ->orderBy('name')->get(['id', 'name', 'price', 'barcode']);
        $allProducts = $products->map(fn (products $product) => [
            'id' => $product->id,
            'name' => $product->name,
            'price' => $product->price,
            'barcode' => $product->barcode,
        ])->all();

        return view('invoice.create', compact('products', 'allProducts'));
    }

    public function searchProducts(Request $request): JsonResponse
    {
        $validated = $request->validate(['q' => ['required', 'string', 'max:100']]);
        $term = trim($validated['q']);

        if ($term === '') {
            return response()->json(['data' => []]);
        }

        $columns = ['id', 'name', 'price', 'barcode'];
        $exactBarcode = products::query()->where('barcode', $term)->first($columns);
        if ($exactBarcode) {
            return response()->json(['data' => [$exactBarcode]]);
        }

        if (mb_strlen($term) < 2) {
            return response()->json(['data' => []]);
        }

        $like = '%'.addcslashes($term, '%_\\').'%';
        $products = products::query()
            ->where(fn ($query) => $query->where('name', 'like', $like)->orWhere('barcode', 'like', $like))
            ->orderByRaw('CASE WHEN name LIKE ? THEN 0 ELSE 1 END, name, id', [addcslashes($term, '%_\\').'%'])
            ->limit(20)
            ->get($columns);

        return response()->json(['data' => $products]);
    }

    public function store(Request $request)
    {
        $validated = $this->validatedInvoiceInput($request);
        $invoice = app(InvoiceCreationService::class)->create(
            $validated,
            $request->user()->id,
            fn (invoice $invoice, array $items, float $total, float $paid) =>
                $this->syncInvoiceInstallment($invoice, $items, $total, $paid)
        );

        return redirect()->route('invoices.index')->with('success', 'تم إنشاء الفاتورة بنجاح.');
    }

    public function edit(invoice $invoice)
    {
        abort_if($invoice->status === 'refunded', 404);
        $snapshotItems = is_array($invoice->items) ? $invoice->items : [];
        $oldProductIds = old('product_ids');
        $productIds = is_array($oldProductIds)
            ? $oldProductIds
            : array_merge(
                collect($snapshotItems)->pluck('product_id')->all(),
                [$invoice->product_id]
            );
        $products = products::query()->whereIn('id', $productIds)
            ->orderBy('name')->get(['id', 'name', 'price', 'barcode']);
        $allProducts = $products->map(fn (products $product) => [
            'id' => $product->id,
            'name' => $product->name,
            'price' => $product->price,
            'barcode' => $product->barcode,
        ])->all();

        return view('invoice.edit', compact('invoice', 'products', 'allProducts'));
    }

    public function show(invoice $invoice)
    {
        $invoice->load('product');

        return view('invoice.show', compact('invoice'));
    }

    public function update(Request $request, invoice $invoice)
    {
        $validated = $this->validatedInvoiceInput($request);
        app(InvoiceCreationService::class)->update(
            $invoice,
            $validated,
            $request->user()->id,
            fn (invoice $updated, array $items, float $total, float $paid) =>
                $this->syncInvoiceInstallment($updated, $items, $total, $paid)
        );

        return redirect()->route('invoices.index')->with('success', 'تم تحديث الفاتورة بنجاح.');
    }

    public function destroy(invoice $invoice)
    {
        $userId = request()->user()->id;

        try {
            DB::transaction(function () use ($invoice, $userId): void {
                $lockedInvoice = invoice::query()->lockForUpdate()->findOrFail($invoice->id);

                if (installments::query()->where('invoice_id', $lockedInvoice->id)->exists()) {
                    throw ValidationException::withMessages(['invoice' => 'لا يمكن حذف فاتورة لها سجل أقساط. استخدم استرداد الفاتورة بدلاً من ذلك.']);
                }

                if ($lockedInvoice->status !== 'refunded') {
                    $quantities = $this->itemQuantities($lockedInvoice);
                    $products = products::query()->whereIn('id', array_keys($quantities))
                        ->orderBy('id')->lockForUpdate()->get()->keyBy('id');

                    foreach ($quantities as $productId => $quantity) {
                        $product = $products->get($productId);
                        if ($product) {
                            $product->stock += $quantity;
                            $product->total_sold = max(0, $product->total_sold - $quantity);
                            $product->save();
                        }
                    }
                }

                AppNotification::create([
                    'title' => 'تم حذف فاتورة',
                    'message' => 'تم حذف الفاتورة #'.$lockedInvoice->invoice_number,
                    'is_active' => true,
                    'created_by' => $userId,
                ]);
                $lockedInvoice->delete();
            }, 3);
        } catch (ValidationException $exception) {
            return redirect()->route('invoices.index')->with('error', $exception->errors()['invoice'][0]);
        }

        return redirect()->route('invoices.index')->with('success', 'تم حذف الفاتورة بنجاح.');
    }

    public function refund(invoice $invoice)
    {
        $userId = request()->user()->id;

        try {
            DB::transaction(function () use ($invoice, $userId): void {
                $lockedInvoice = invoice::query()->lockForUpdate()->findOrFail($invoice->id);
                if ($lockedInvoice->status === 'refunded') {
                    throw ValidationException::withMessages(['invoice' => 'تم استرداد هذه الفاتورة من قبل.']);
                }

                $quantities = $this->itemQuantities($lockedInvoice);
                $products = products::query()->whereIn('id', array_keys($quantities))
                    ->orderBy('id')->lockForUpdate()->get()->keyBy('id');

                foreach ($quantities as $productId => $quantity) {
                    $product = $products->get($productId);
                    if ($product) {
                        $product->stock += $quantity;
                        $product->total_sold = max(0, $product->total_sold - $quantity);
                        $product->save();
                    }
                }

                $lockedInvoice->update(['status' => 'refunded']);
                installments::query()->where('invoice_id', $lockedInvoice->id)->update([
                    'remaining' => 0,
                    'status' => 'مسترد',
                    'next_payment_date' => null,
                ]);
                AppNotification::create([
                    'title' => 'تم استرجاع فاتورة',
                    'message' => 'تم استرجاع الفاتورة #'.$lockedInvoice->invoice_number,
                    'is_active' => true,
                    'created_by' => $userId,
                ]);
            }, 3);
        } catch (ValidationException $exception) {
            return redirect()->route('invoices.index')->with('error', $exception->errors()['invoice'][0]);
        }

        return redirect()->route('invoices.index')->with('success', 'تم استرداد الفاتورة بنجاح.');
    }

    public function print(invoice $invoice)
    {
        $invoice->load('product');

        return view('invoice.print', compact('invoice'));
    }

    private function validatedInvoiceInput(Request $request): array
    {
        if ($request->filled('barcode')) {
            $request->validate(['barcode' => ['string', 'max:80']]);
            $product = products::where('barcode', trim($request->input('barcode')))->first();
            if (!$product) {
                throw ValidationException::withMessages(['barcode' => 'لا يوجد منتج مطابق لهذا الباركود.']);
            }

            $productIds = $request->input('product_ids', []);
            $quantities = $request->input('quantities', []);
            $productIds = is_array($productIds) ? $productIds : [];
            $quantities = is_array($quantities) ? $quantities : [];
            $productIds[] = $product->id;
            $quantities[] = 1;
            $request->merge(['product_ids' => $productIds, 'quantities' => $quantities]);
        }

        $productIds = $request->input('product_ids', []);
        $quantityCount = is_array($productIds) ? count($productIds) : 0;

        return $request->validate([
            'customer' => ['required', 'string', 'max:255'],
            'product_ids' => ['required', 'array', 'min:1', 'max:100'],
            'product_ids.*' => ['required', 'integer'],
            'quantities' => ['required', 'array', 'size:'.$quantityCount, 'max:100'],
            'quantities.*' => ['required', 'integer', 'min:1', 'max:100000'],
            'invoice_date' => ['required', 'date'],
            'paid_amount' => ['required', 'numeric', 'decimal:0,2', 'min:0'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ], ['notes.max' => 'يجب ألا تتجاوز الملاحظات 2000 حرف.']);
    }

    private function itemQuantities(invoice $invoice): array
    {
        $items = is_array($invoice->items) && $invoice->items !== []
            ? $invoice->items
            : [['product_id' => $invoice->product_id, 'quantity' => $invoice->quantity]];
        $quantities = [];

        foreach ($items as $item) {
            $productId = (int) ($item['product_id'] ?? 0);
            $quantity = (int) ($item['quantity'] ?? 0);
            if ($productId > 0 && $quantity > 0) {
                $quantities[$productId] = ($quantities[$productId] ?? 0) + $quantity;
            }
        }

        return $quantities;
    }

    private function syncInvoiceInstallment(invoice $invoice, array $items, float $totalAmount, float $paidAmount): void
    {
        app(InvoiceInstallmentSync::class)->sync($invoice, $items, $totalAmount, $paidAmount);
    }
}
