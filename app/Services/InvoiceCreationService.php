<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\invoice;
use App\Models\products;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class InvoiceCreationService
{
    public function create(array $data, int $userId, callable $syncInstallment): invoice
    {
        return DB::transaction(function () use ($data, $userId, $syncInstallment): invoice {
            $productIds = array_values(array_unique($data['product_ids']));
            $lockedProducts = products::query()->whereIn('id', $productIds)
                ->orderBy('id')->lockForUpdate()->get()->keyBy('id');

            if ($lockedProducts->count() !== count($productIds)) {
                throw ValidationException::withMessages(['product_ids' => 'أحد المنتجات المحددة لم يعد متاحاً.']);
            }

            $items = [];
            $quantitiesByProduct = [];
            $totalCents = 0;
            $totalQuantity = 0;

            foreach ($data['product_ids'] as $index => $productId) {
                $quantity = (int) $data['quantities'][$index];
                $product = $lockedProducts->get($productId);
                $priceCents = (int) round((float) $product->price * 100);
                $lineTotalCents = $priceCents * $quantity;

                $items[] = [
                    'product_id' => $product->id,
                    'name' => $product->name,
                    'price' => number_format($priceCents / 100, 2, '.', ''),
                    'quantity' => $quantity,
                    'line_total' => number_format($lineTotalCents / 100, 2, '.', ''),
                ];

                $quantitiesByProduct[$product->id] = ($quantitiesByProduct[$product->id] ?? 0) + $quantity;
                $totalCents += $lineTotalCents;
                $totalQuantity += $quantity;
            }

            foreach ($quantitiesByProduct as $productId => $quantity) {
                if ($lockedProducts->get($productId)->stock < $quantity) {
                    throw ValidationException::withMessages([
                        'product_ids' => 'المخزون غير كافٍ للمنتج '.$lockedProducts->get($productId)->name.'.',
                    ]);
                }
            }

            $paidCents = (int) round((float) $data['paid_amount'] * 100);
            if ($paidCents > $totalCents) {
                throw ValidationException::withMessages(['paid_amount' => 'لا يمكن أن يتجاوز المبلغ المدفوع إجمالي الفاتورة.']);
            }

            do {
                $invoiceNumber = 'INV-'.now()->format('YmdHis').'-'.Str::upper(Str::random(8));
            } while (invoice::query()->where('invoice_number', $invoiceNumber)->exists());

            $firstProduct = $lockedProducts->get($data['product_ids'][0]);
            $totalAmount = number_format($totalCents / 100, 2, '.', '');
            $paidAmount = number_format($paidCents / 100, 2, '.', '');

            $invoice = invoice::create([
                'invoice_number' => $invoiceNumber,
                'customer' => $data['customer'],
                'product_id' => $firstProduct->id,
                'quantity' => $totalQuantity,
                'invoice_date' => $data['invoice_date'],
                'total_amount' => $totalAmount,
                'product_price' => $firstProduct->price,
                'paid_amount' => $paidAmount,
                'status' => $paidCents >= $totalCents ? 'paid' : 'unpaid',
                'items' => $items,
                'notes' => $data['notes'] ?? null,
            ]);

            foreach ($quantitiesByProduct as $productId => $quantity) {
                $product = $lockedProducts->get($productId);
                $product->stock -= $quantity;
                $product->total_sold += $quantity;
                $product->save();
            }

            $syncInstallment($invoice, $items, $totalCents / 100, $paidCents / 100);

            AppNotification::create([
                'title' => 'تم إنشاء فاتورة',
                'message' => 'تم إنشاء الفاتورة #'.$invoice->invoice_number,
                'is_active' => true,
                'created_by' => $userId,
            ]);

            return $invoice;
        }, 3);
    }

    public function update(invoice $invoice, array $data, int $userId, callable $syncInstallment): invoice
    {
        return DB::transaction(function () use ($invoice, $data, $userId, $syncInstallment): invoice {
            $lockedInvoice = invoice::query()->lockForUpdate()->findOrFail($invoice->id);
            if ($lockedInvoice->status === 'refunded') {
                throw ValidationException::withMessages(['invoice' => 'لا يمكن تعديل فاتورة مستردة.']);
            }

            $oldQuantities = $this->itemQuantities($lockedInvoice);
            $newQuantities = [];
            $productIds = array_values(array_unique(array_merge(
                array_keys($oldQuantities),
                $data['product_ids']
            )));
            $lockedProducts = products::query()->whereIn('id', $productIds)
                ->orderBy('id')->lockForUpdate()->get()->keyBy('id');

            if ($lockedProducts->count() !== count($productIds)) {
                throw ValidationException::withMessages(['product_ids' => 'أحد منتجات الفاتورة لم يعد متاحاً.']);
            }

            $items = [];
            $totalCents = 0;
            $totalQuantity = 0;

            foreach ($data['product_ids'] as $index => $productId) {
                $quantity = (int) $data['quantities'][$index];
                $product = $lockedProducts->get($productId);
                $priceCents = (int) round((float) $product->price * 100);
                $lineTotalCents = $priceCents * $quantity;

                $items[] = [
                    'product_id' => $product->id,
                    'name' => $product->name,
                    'price' => number_format($priceCents / 100, 2, '.', ''),
                    'quantity' => $quantity,
                    'line_total' => number_format($lineTotalCents / 100, 2, '.', ''),
                ];
                $newQuantities[$product->id] = ($newQuantities[$product->id] ?? 0) + $quantity;
                $totalCents += $lineTotalCents;
                $totalQuantity += $quantity;
            }

            $paidCents = (int) round((float) $data['paid_amount'] * 100);
            if ($paidCents > $totalCents) {
                throw ValidationException::withMessages(['paid_amount' => 'لا يمكن أن يتجاوز المبلغ المدفوع إجمالي الفاتورة.']);
            }

            foreach ($productIds as $productId) {
                $product = $lockedProducts->get($productId);
                $stock = $product->stock + ($oldQuantities[$productId] ?? 0) - ($newQuantities[$productId] ?? 0);
                if ($stock < 0) {
                    throw ValidationException::withMessages([
                        'product_ids' => 'المخزون غير كافٍ للمنتج '.$product->name.'.',
                    ]);
                }
                $product->stock = $stock;
                $product->total_sold = max(0, $product->total_sold - ($oldQuantities[$productId] ?? 0) + ($newQuantities[$productId] ?? 0));
                $product->save();
            }

            $firstProduct = $lockedProducts->get($data['product_ids'][0]);
            $total = number_format($totalCents / 100, 2, '.', '');
            $paid = number_format($paidCents / 100, 2, '.', '');
            $lockedInvoice->update([
                'customer' => $data['customer'],
                'product_id' => $firstProduct->id,
                'quantity' => $totalQuantity,
                'invoice_date' => $data['invoice_date'],
                'total_amount' => $total,
                'product_price' => $firstProduct->price,
                'paid_amount' => $paid,
                'status' => $paidCents >= $totalCents ? 'paid' : 'unpaid',
                'items' => $items,
                'notes' => $data['notes'] ?? $lockedInvoice->notes,
            ]);

            $syncInstallment($lockedInvoice, $items, $totalCents / 100, $paidCents / 100);
            AppNotification::create([
                'title' => 'تم تحديث فاتورة',
                'message' => 'تم تحديث الفاتورة #'.$lockedInvoice->invoice_number,
                'is_active' => true,
                'created_by' => $userId,
            ]);

            return $lockedInvoice->refresh();
        }, 3);
    }

    /** @return array<int, int> */
    /**
     * Refund an invoice: the sold units go back to stock, the invoice is marked
     * refunded and any installment attached to it is closed.
     */
    public function refund(invoice $invoice, int $userId): invoice
    {
        return DB::transaction(function () use ($invoice, $userId): invoice {
            $locked = invoice::query()->lockForUpdate()->findOrFail($invoice->id);
            if ($locked->status === 'refunded') {
                throw ValidationException::withMessages(['invoice' => 'تم استرداد هذه الفاتورة من قبل.']);
            }

            $quantities = $this->itemQuantities($locked);
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

            $locked->update(['status' => 'refunded']);
            \App\Models\installments::query()->where('invoice_id', $locked->id)->update([
                'remaining' => 0,
                'status' => 'مسترد',
                'next_payment_date' => null,
            ]);
            AppNotification::query()->create([
                'title' => 'تم استرجاع فاتورة',
                'message' => 'تم استرجاع الفاتورة #'.$locked->invoice_number,
                'is_active' => true,
                'created_by' => $userId,
            ]);

            return $locked->refresh();
        }, 3);
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
}
