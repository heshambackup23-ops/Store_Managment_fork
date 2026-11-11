<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\CreateInvoiceRequest;
use App\Http\Requests\Api\InvoiceIndexRequest;
use App\Http\Resources\Api\InvoiceResource;
use App\Http\Requests\Api\PayInvoiceRequest;
use App\Http\Requests\Api\RefundInvoiceRequest;
use App\Http\Requests\Api\UpdateInvoiceRequest;
use App\Models\AppNotification;
use App\Models\invoice;
use App\Services\ApiIdempotencyService;
use App\Services\InvoiceCreationService;
use App\Services\InvoiceInstallmentSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

class InvoiceController
{
    public function index(InvoiceIndexRequest $request): AnonymousResourceCollection
    {
        $filters = $request->validated();
        $query = invoice::query()->select([
            'id', 'invoice_number', 'customer', 'invoice_date', 'status', 'quantity',
            'total_amount', 'paid_amount', 'items', 'notes', 'created_at',
        ]);
        $term = trim((string) ($filters['q'] ?? ''));

        if ($term !== '') {
            $search = '%'.addcslashes($term, '%_\\').'%';
            $query->where(fn ($query) => $query
                ->where('customer', 'like', $search)
                ->orWhere('invoice_number', 'like', $search));
        }

        return InvoiceResource::collection(
            $query->orderByDesc('id')->paginate($filters['per_page'] ?? 20)
        );
    }

    public function show(invoice $invoice): InvoiceResource
    {
        return new InvoiceResource($invoice);
    }

    public function pdf(invoice $invoice): Response
    {
        abort_unless(class_exists(\Mpdf\Mpdf::class), 501, 'PDF generation is unavailable.');
        $invoice->loadMissing('product');
        $html = view('invoice.pdf', compact('invoice'))->render();
        $temporaryDirectory = storage_path('app/mpdf-temp');
        \Illuminate\Support\Facades\File::ensureDirectoryExists($temporaryDirectory);
        $pdf = new \Mpdf\Mpdf([
            'mode' => 'utf-8',
            'format' => 'A4',
            'tempDir' => $temporaryDirectory,
            'autoScriptToLang' => true,
            'autoLangToFont' => true,
            'default_font' => 'dejavusans',
        ]);
        $pdf->WriteHTML($html);
        $contents = $pdf->Output('', \Mpdf\Output\Destination::STRING_RETURN);

        return response($contents, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="invoice-'.$invoice->id.'.pdf"',
            'Content-Length' => (string) strlen($contents),
            'Cache-Control' => 'private, no-store',
        ]);
    }

    public function store(
        CreateInvoiceRequest $request,
        ApiIdempotencyService $idempotency,
        InvoiceCreationService $invoices,
        InvoiceInstallmentSync $installments
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'invoices.create',
            $key,
            $data,
            function () use ($request, $data, $invoices, $installments): array {
                $invoice = $invoices->create(
                    $data,
                    (int) $request->user()->id,
                    fn (invoice $invoice, array $items, float $total, float $paid) =>
                        $installments->sync($invoice, $items, $total, $paid)
                );

                return [
                    'status' => 201,
                    'body' => ['data' => (new InvoiceResource($invoice))->resolve($request)],
                ];
            }
        );
    }

    public function update(
        UpdateInvoiceRequest $request,
        invoice $invoice,
        ApiIdempotencyService $idempotency,
        InvoiceCreationService $invoices,
        InvoiceInstallmentSync $installments,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'invoices.update',
            $key,
            ['invoice_id' => $invoice->id] + $data,
            function () use ($request, $invoice, $data, $invoices, $installments): array {
                $updated = $invoices->update(
                    $invoice,
                    $data,
                    (int) $request->user()->id,
                    fn (invoice $locked, array $items, float $total, float $paid) =>
                        $installments->sync($locked, $items, $total, $paid)
                );

                return ['status' => 200, 'body' => ['data' => (new InvoiceResource($updated))->resolve($request)]];
            }
        );
    }

    public function pay(
        PayInvoiceRequest $request,
        invoice $invoice,
        ApiIdempotencyService $idempotency,
        InvoiceInstallmentSync $installments,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'invoices.pay',
            $key,
            ['invoice_id' => $invoice->id] + $data,
            function () use ($request, $invoice, $data, $installments): array {
                $paidInvoice = DB::transaction(function () use ($request, $invoice, $data, $installments): invoice {
                    $locked = invoice::query()->lockForUpdate()->findOrFail($invoice->id);
                    if ($locked->status === 'refunded') {
                        throw ValidationException::withMessages(['invoice' => 'لا يمكن تسجيل دفعة على فاتورة مستردة.']);
                    }

                    $totalCents = (int) round((float) $locked->total_amount * 100);
                    $paidCents = (int) round((float) $locked->paid_amount * 100);
                    $remainingCents = max(0, $totalCents - $paidCents);
                    if ($remainingCents === 0) {
                        throw ValidationException::withMessages(['amount' => 'الفاتورة مدفوعة بالكامل بالفعل.']);
                    }

                    $paymentCents = isset($data['amount']) && $data['amount'] !== ''
                        ? (int) round((float) $data['amount'] * 100)
                        : $remainingCents;
                    if ($paymentCents <= 0 || $paymentCents > $remainingCents) {
                        throw ValidationException::withMessages(['amount' => 'لا يمكن أن تتجاوز الدفعة إجمالي المبلغ المتبقي.']);
                    }

                    $paidCents += $paymentCents;
                    $locked->update([
                        'paid_amount' => number_format($paidCents / 100, 2, '.', ''),
                        'status' => $paidCents >= $totalCents ? 'paid' : 'unpaid',
                    ]);
                    $items = is_array($locked->items) ? $locked->items : [];
                    $installments->sync($locked, $items, $totalCents / 100, $paidCents / 100);

                    AppNotification::query()->create([
                        'title' => 'تم استلام دفعة فاتورة',
                        'message' => 'تم استلام دفعة بمبلغ '.number_format($paymentCents / 100, 2, '.', '').' على الفاتورة #'.$locked->invoice_number,
                        'is_active' => true,
                        'created_by' => $request->user()->id,
                    ]);

                    return $locked->refresh();
                }, 3);

                return ['status' => 200, 'body' => ['data' => (new InvoiceResource($paidInvoice))->resolve($request)]];
            }
        );
    }

    public function refund(
        RefundInvoiceRequest $request,
        invoice $invoice,
        ApiIdempotencyService $idempotency,
        InvoiceCreationService $invoices,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];

        return $idempotency->execute(
            $request->user(),
            'invoices.refund',
            $key,
            ['invoice_id' => $invoice->id],
            function () use ($request, $invoice, $invoices): array {
                $refunded = $invoices->refund($invoice, (int) $request->user()->id);

                return ['status' => 200, 'body' => ['data' => (new InvoiceResource($refunded))->resolve($request)]];
            }
        );
    }
}
