<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\CashierCheckoutRequest;
use App\Http\Controllers\CashierController as WebCashierController;
use App\Models\invoice;
use App\Models\products;
use App\Services\ApiIdempotencyService;
use App\Services\InvoiceCreationService;
use App\Services\InvoiceInstallmentSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class CashierController
{
    public function products(Request $request, WebCashierController $cashier): JsonResponse
    {
        return $cashier->search($request);
    }

    public function checkout(
        CashierCheckoutRequest $request,
        ApiIdempotencyService $idempotency,
        InvoiceCreationService $invoices,
        InvoiceInstallmentSync $installments,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'cashier.checkout',
            $key,
            $data,
            function () use ($request, $data, $invoices, $installments): array {
                $lines = [];
                foreach ($data['items'] as $item) {
                    $productId = (int) $item['product_id'];
                    $lines[$productId] = ($lines[$productId] ?? 0) + (int) $item['quantity'];
                }

                $prices = products::query()->whereIn('id', array_keys($lines))->pluck('price', 'id');
                if ($prices->count() !== count($lines)) {
                    throw ValidationException::withMessages(['items' => 'منتج في السلة لم يعد موجوداً. أزله ثم حاول مرة أخرى.']);
                }

                $totalCents = 0;
                foreach ($lines as $productId => $quantity) {
                    $totalCents += (int) round((float) $prices[$productId] * 100) * $quantity;
                }

                $receivedCents = isset($data['received'])
                    ? (int) round((float) $data['received'] * 100)
                    : $totalCents;
                $paidCents = min($receivedCents, $totalCents);
                $customer = trim((string) preg_replace('/\s+/u', ' ', (string) ($data['customer'] ?? '')));
                if ($paidCents < $totalCents && $customer === '') {
                    throw ValidationException::withMessages(['customer' => 'اسم العميل مطلوب عند الدفع الجزئي.']);
                }

                $invoice = $invoices->create(
                    [
                        'customer' => $customer === '' ? 'زبون نقدي' : $customer,
                        'product_ids' => array_keys($lines),
                        'quantities' => array_values($lines),
                        'invoice_date' => now()->toDateString(),
                        'paid_amount' => number_format($paidCents / 100, 2, '.', ''),
                    ],
                    (int) $request->user()->id,
                    fn (invoice $invoice, array $items, float $total, float $paid) =>
                        $installments->sync($invoice, $items, $total, $paid)
                );

                $invoiceTotalCents = (int) round((float) $invoice->total_amount * 100);
                $invoicePaidCents = (int) round((float) $invoice->paid_amount * 100);

                return [
                    'status' => 201,
                    'body' => ['data' => [
                        'invoice_id' => $invoice->id,
                        'invoice_number' => $invoice->invoice_number,
                        'total' => number_format($invoiceTotalCents / 100, 2, '.', ''),
                        'paid' => number_format($invoicePaidCents / 100, 2, '.', ''),
                        'remaining' => number_format(max(0, $invoiceTotalCents - $invoicePaidCents) / 100, 2, '.', ''),
                        'change' => number_format(max(0, $receivedCents - $invoicePaidCents) / 100, 2, '.', ''),
                    ]],
                ];
            }
        );
    }
}
