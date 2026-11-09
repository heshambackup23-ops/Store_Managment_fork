<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\CreateInvoiceRequest;
use App\Http\Requests\Api\InvoiceIndexRequest;
use App\Http\Resources\Api\InvoiceResource;
use App\Models\invoice;
use App\Services\ApiIdempotencyService;
use App\Services\InvoiceCreationService;
use App\Services\InvoiceInstallmentSync;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

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
}
