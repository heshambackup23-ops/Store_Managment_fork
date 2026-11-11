<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\installments as Installment;
use App\Models\products as Product;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InstallmentWorkflowService
{
    public function create(array $validated, int $userId): Installment
    {
        return DB::transaction(function () use ($validated, $userId): Installment {
            if (! empty($validated['product_ids'])) {
                [$items, $totalQuantity, $totalCents, $products] = $this->buildItems($validated);
                $productName = collect($items)->pluck('name')->implode(', ');
                $productId = $products->get($validated['product_ids'][0])->id;
            } else {
                $totalCents = (int) round((float) $validated['total_amount'] * 100);
                $totalQuantity = 1;
                $productName = trim($validated['product_name']);
                $productId = null;
                $products = collect();
                $items = [[
                    'product_id' => null,
                    'name' => $productName,
                    'price' => number_format($totalCents / 100, 2, '.', ''),
                    'quantity' => 1,
                    'line_total' => number_format($totalCents / 100, 2, '.', ''),
                ]];
            }
            $paidCents = (int) round((float) $validated['paid_amount'] * 100);

            if ($paidCents > $totalCents) {
                throw ValidationException::withMessages([
                    'paid_amount' => 'لا يمكن أن يتجاوز المبلغ المدفوع إجمالي القسط.',
                ]);
            }

            $complete = $paidCents === $totalCents;
            $installment = Installment::query()->create([
                'customer' => $validated['customer'],
                'product_id' => $productId,
                'product_name' => $productName,
                'product_price' => number_format($totalCents / 100, 2, '.', ''),
                'quantity' => $totalQuantity,
                'payment_date' => $validated['payment_date'] ?? null,
                'next_payment_date' => $complete ? null : ($validated['next_payment_date'] ?? null),
                'paid_amount' => number_format($paidCents / 100, 2, '.', ''),
                'remaining' => number_format(($totalCents - $paidCents) / 100, 2, '.', ''),
                'status' => $complete ? 'مكتمل' : 'غير مكتمل',
                'items' => $items,
                'notes' => $validated['notes'] ?? null,
            ]);

            if (! $complete) {
                app(CustomerLedgerService::class)->syncNamedCustomer($validated['customer'], $installment);
            }

            AppNotification::query()->create([
                'title' => 'تم إضافة دين',
                'message' => 'تم إضافة دين للعميل '.$validated['customer'],
                'is_active' => true,
                'created_by' => $userId,
            ]);

            return $installment;
        }, 3);
    }

    public function update(Installment $installment, array $validated, int $userId): Installment
    {
        return DB::transaction(function () use ($installment, $validated, $userId): Installment {
            $locked = Installment::query()->lockForUpdate()->findOrFail($installment->id);
            if ($locked->invoice_id) {
                throw ValidationException::withMessages([
                    'installment' => 'يجب تعديل الأقساط المرتبطة بفاتورة من صفحة الفاتورة.',
                ]);
            }

            if (! empty($validated['product_ids'])) {
                [$items, $quantity, $totalCents, $products] = $this->buildItems($validated);
                $productId = $products->get($validated['product_ids'][0])->id;
                $productName = collect($items)->pluck('name')->implode(', ');
            } else {
                $totalCents = (int) round((float) $validated['total_amount'] * 100);
                $quantity = 1;
                $productId = null;
                $productName = trim($validated['product_name']);
                $items = [[
                    'product_id' => null,
                    'name' => $productName,
                    'price' => number_format($totalCents / 100, 2, '.', ''),
                    'quantity' => 1,
                    'line_total' => number_format($totalCents / 100, 2, '.', ''),
                ]];
            }

            $paidCents = (int) round((float) $validated['paid_amount'] * 100);
            if ($paidCents > $totalCents) {
                throw ValidationException::withMessages([
                    'paid_amount' => 'لا يمكن أن يتجاوز المبلغ المدفوع إجمالي القسط.',
                ]);
            }

            $complete = $paidCents === $totalCents;
            $locked->update([
                'customer' => $validated['customer'],
                'product_id' => $productId,
                'product_name' => $productName,
                'product_price' => number_format($totalCents / 100, 2, '.', ''),
                'quantity' => $quantity,
                'payment_date' => $validated['payment_date'] ?? null,
                'next_payment_date' => $complete ? null : ($validated['next_payment_date'] ?? null),
                'paid_amount' => number_format($paidCents / 100, 2, '.', ''),
                'remaining' => number_format(($totalCents - $paidCents) / 100, 2, '.', ''),
                'status' => $complete ? 'مكتمل' : 'غير مكتمل',
                'items' => $items,
                'notes' => $validated['notes'] ?? $locked->notes,
            ]);

            if (! $complete) {
                app(CustomerLedgerService::class)->syncNamedCustomer($validated['customer'], $locked);
            }

            AppNotification::query()->create([
                'title' => 'تم تحديث دين',
                'message' => 'تم تحديث الدين #'.$locked->id,
                'is_active' => true,
                'created_by' => $userId,
            ]);

            return $locked->refresh();
        }, 3);
    }

    public function changeStatus(Installment $installment, string $status): Installment
    {
        return DB::transaction(function () use ($installment, $status): Installment {
            $locked = Installment::query()->lockForUpdate()->findOrFail($installment->id);
            $remainingCents = (int) round((float) $locked->remaining * 100);

            if ($status === 'مكتمل' && $remainingCents > 0) {
                throw ValidationException::withMessages([
                    'status' => 'لا يمكن تعليم القسط مكتملًا وفي ذمته مبلغ متبقٍ. سجّل دفعة أولًا.',
                ]);
            }
            if (in_array($status, ['غير مكتمل', 'متأخر'], true) && $remainingCents <= 0) {
                throw ValidationException::withMessages([
                    'status' => 'هذا القسط مسدد بالكامل ولا يمكن إعادته إلى غير مكتمل من زر الحالة.',
                ]);
            }

            $locked->update(['status' => $status]);

            return $locked->refresh();
        }, 3);
    }

    /** @return array{0:array<int, array<string, int|string>>,1:int,2:int,3:\Illuminate\Support\Collection<int, Product>} */
    public function buildItems(array $validated): array
    {
        $productIds = array_values(array_unique($validated['product_ids']));
        $products = Product::query()->whereIn('id', $productIds)->orderBy('id')
            ->lockForUpdate()->get()->keyBy('id');

        if ($products->count() !== count($productIds)) {
            throw ValidationException::withMessages([
                'product_ids' => 'أحد المنتجات المحددة لم يعد متاحاً.',
            ]);
        }

        $items = [];
        $totalQuantity = 0;
        $totalCents = 0;

        foreach ($validated['product_ids'] as $index => $productId) {
            $product = $products->get($productId);
            $quantity = (int) $validated['quantities'][$index];
            $priceCents = (int) round((float) $product->price * 100);
            $lineTotalCents = $priceCents * $quantity;
            $items[] = [
                'product_id' => $product->id,
                'name' => $product->name,
                'price' => number_format($priceCents / 100, 2, '.', ''),
                'quantity' => $quantity,
                'line_total' => number_format($lineTotalCents / 100, 2, '.', ''),
            ];
            $totalQuantity += $quantity;
            $totalCents += $lineTotalCents;
        }

        return [$items, $totalQuantity, $totalCents, $products];
    }
}
