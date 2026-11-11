<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\InstallmentIndexRequest;
use App\Http\Requests\Api\CreateInstallmentRequest;
use App\Http\Requests\Api\UpdateInstallmentRequest;
use App\Http\Requests\Api\DeleteInstallmentRequest;
use App\Http\Requests\Api\PayInstallmentRequest;
use App\Http\Requests\Api\UpdateInstallmentStatusRequest;
use App\Http\Resources\Api\InstallmentResource;
use App\Models\AppNotification;
use App\Models\installments as Installment;
use App\Models\invoice as Invoice;
use App\Services\ApiIdempotencyService;
use App\Services\CustomerLedgerService;
use App\Services\InvoiceInstallmentSync;
use App\Services\InstallmentWorkflowService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class InstallmentController
{
    public function index(InstallmentIndexRequest $request): AnonymousResourceCollection
    {
        $filters = $request->validated();
        $query = Installment::query()->select([
            'id', 'invoice_id', 'customer_id', 'customer', 'product_id', 'product_name',
            'product_price', 'payment_date', 'next_payment_date', 'paid_amount', 'remaining',
            'quantity', 'status', 'items',
        ]);
        $term = trim((string) ($filters['q'] ?? ''));

        if ($term !== '') {
            $search = '%'.addcslashes($term, '%_\\').'%';
            $query->where(fn ($query) => $query
                ->where('customer', 'like', $search)
                ->orWhere('product_name', 'like', $search));
        }

        return InstallmentResource::collection(
            $query->orderByDesc('id')->paginate($filters['per_page'] ?? 20)
        );
    }

    public function show(Installment $installment): InstallmentResource
    {
        return new InstallmentResource($installment);
    }

    public function store(
        CreateInstallmentRequest $request,
        ApiIdempotencyService $idempotency,
        InstallmentWorkflowService $workflow
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'installments.create',
            $key,
            $data,
            function () use ($request, $data, $workflow): array {
                $installment = $workflow->create($data, (int) $request->user()->id);

                return [
                    'status' => 201,
                    'body' => ['data' => (new InstallmentResource($installment))->resolve($request)],
                ];
            }
        );
    }

    public function update(
        UpdateInstallmentRequest $request,
        Installment $installment,
        ApiIdempotencyService $idempotency,
        InstallmentWorkflowService $workflow,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'installments.update',
            $key,
            ['installment_id' => $installment->id] + $data,
            function () use ($request, $installment, $workflow, $data): array {
                $updated = $workflow->update($installment, $data, (int) $request->user()->id);

                return ['status' => 200, 'body' => ['data' => (new InstallmentResource($updated))->resolve($request)]];
            }
        );
    }

    public function destroy(
        DeleteInstallmentRequest $request,
        Installment $installment,
        ApiIdempotencyService $idempotency,
    ): JsonResponse {
        $key = $request->validated('idempotency_key');

        return $idempotency->execute(
            $request->user(),
            'installments.delete',
            $key,
            ['installment_id' => $installment->id],
            function () use ($request, $installment): array {
                DB::transaction(function () use ($request, $installment): void {
                    $locked = Installment::query()->lockForUpdate()->findOrFail($installment->id);
                    if ($locked->invoice_id) {
                        throw ValidationException::withMessages([
                            'installment' => 'لا يمكن حذف قسط مرتبط بفاتورة.',
                        ]);
                    }
                    $locked->delete();
                    AppNotification::query()->create([
                        'title' => 'تم حذف دين',
                        'message' => 'تم حذف الدين #'.$locked->id,
                        'is_active' => true,
                        'created_by' => $request->user()->id,
                    ]);
                }, 3);

                return ['status' => 204, 'body' => []];
            }
        );
    }

    public function changeStatus(
        UpdateInstallmentStatusRequest $request,
        Installment $installment,
        ApiIdempotencyService $idempotency,
        InstallmentWorkflowService $workflow,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'installments.status',
            $key,
            ['installment_id' => $installment->id] + $data,
            function () use ($request, $installment, $workflow, $data): array {
                $updated = $workflow->changeStatus($installment, $data['status']);

                return ['status' => 200, 'body' => ['data' => (new InstallmentResource($updated))->resolve($request)]];
            }
        );
    }

    public function pay(
        PayInstallmentRequest $request,
        Installment $installment,
        ApiIdempotencyService $idempotency,
        InvoiceInstallmentSync $invoiceInstallments,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'installments.pay',
            $key,
            ['installment_id' => $installment->id] + $data,
            function () use ($request, $installment, $data, $invoiceInstallments): array {
                $updated = DB::transaction(function () use ($request, $installment, $data, $invoiceInstallments): Installment {
                    $locked = Installment::query()->lockForUpdate()->findOrFail($installment->id);
                    $remainingCents = (int) round((float) $locked->remaining * 100);
                    if ($locked->status === 'مكتمل' || $remainingCents <= 0) {
                        throw ValidationException::withMessages(['amount' => 'هذا القسط مكتمل بالفعل.']);
                    }

                    $paymentCents = isset($data['amount']) && $data['amount'] !== ''
                        ? (int) round((float) $data['amount'] * 100)
                        : $remainingCents;
                    if ($paymentCents <= 0 || $paymentCents > $remainingCents) {
                        throw ValidationException::withMessages(['amount' => 'لا يمكن أن تتجاوز الدفعة الرصيد المتبقي.']);
                    }

                    $paidCents = (int) round((float) $locked->paid_amount * 100) + $paymentCents;
                    $remainingCents -= $paymentCents;
                    $complete = $remainingCents === 0;
                    $locked->update([
                        'paid_amount' => number_format($paidCents / 100, 2, '.', ''),
                        'remaining' => number_format($remainingCents / 100, 2, '.', ''),
                        'status' => $complete ? 'مكتمل' : 'غير مكتمل',
                        'payment_date' => now()->toDateString(),
                        'next_payment_date' => $complete ? null : now()->addMonth()->toDateString(),
                    ]);

                    if ($locked->invoice_id) {
                        $invoice = Invoice::query()->lockForUpdate()->findOrFail($locked->invoice_id);
                        $invoiceTotalCents = (int) round((float) $invoice->total_amount * 100);
                        $invoicePaidCents = (int) round((float) $invoice->paid_amount * 100);
                        if ($invoice->status === 'refunded' || $paymentCents > $invoiceTotalCents - $invoicePaidCents) {
                            throw ValidationException::withMessages(['amount' => 'لا يمكن تسجيل هذه الدفعة على الفاتورة.']);
                        }
                        $invoicePaidCents += $paymentCents;
                        $invoice->update([
                            'paid_amount' => number_format($invoicePaidCents / 100, 2, '.', ''),
                            'status' => $invoicePaidCents >= $invoiceTotalCents ? 'paid' : 'unpaid',
                        ]);
                        $items = is_array($invoice->items) ? $invoice->items : [];
                        $invoiceInstallments->sync($invoice, $items, $invoiceTotalCents / 100, $invoicePaidCents / 100);
                    } else {
                        app(CustomerLedgerService::class)->syncNamedCustomer($locked->customer, $locked);
                    }

                    AppNotification::query()->create([
                        'title' => 'تم استلام دفعة',
                        'message' => 'تم استلام دفعة بمبلغ '.number_format($paymentCents / 100, 2, '.', '').' على الدين #'.$locked->id,
                        'is_active' => true,
                        'created_by' => $request->user()->id,
                    ]);

                    return $locked->refresh();
                }, 3);

                return ['status' => 200, 'body' => ['data' => (new InstallmentResource($updated))->resolve($request)]];
            }
        );
    }
}
