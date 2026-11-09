<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\InstallmentIndexRequest;
use App\Http\Resources\Api\InstallmentResource;
use App\Models\installments as Installment;
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
}