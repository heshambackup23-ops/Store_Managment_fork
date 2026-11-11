@extends('layouts.invoice-print')
@section('title', 'Bebo | Invoice ' . $invoice->invoice_number)

@section('content')
@php
    $items = is_array($invoice->items) && $invoice->items !== []
        ? $invoice->items
        : [[
            'name' => $invoice->product?->name ?? '—',
            'quantity' => $invoice->quantity,
            'price' => $invoice->product_price,
            'line_total' => $invoice->total_amount,
        ]];
    $remaining = max(0, (float) $invoice->total_amount - (float) $invoice->paid_amount);
    $statusLabels = ['paid' => 'مدفوعة', 'unpaid' => 'غير مدفوعة', 'refunded' => 'مستردة'];
@endphp

<div class="container py-4">
    <div class="invoice-actions d-flex flex-wrap justify-content-between align-items-center gap-2 no-print">
        <a href="{{ route('invoices.show', $invoice) }}" class="btn btn-outline-secondary">العودة إلى الفاتورة</a>
        <button type="button" onclick="window.print()" class="btn btn-primary">
            <i class="fa-solid fa-print ms-1" aria-hidden="true"></i> طباعة الفاتورة
        </button>
    </div>

    <article class="invoice-paper border rounded-4 shadow-sm p-4 p-md-5">
        <header class="d-flex justify-content-between align-items-start gap-3 border-bottom pb-3 mb-4">
            <div>
                <h1 class="invoice-brand h2 fw-bold mb-2">Bebo</h1>
                <div class="text-secondary">فاتورة بيع</div>
            </div>
            <div class="text-start">
                <div class="text-secondary small">رقم الفاتورة</div>
                <div class="fw-bold">{{ $invoice->invoice_number }}</div>
                <div class="text-secondary small mt-2">التاريخ</div>
                <div>{{ \Carbon\Carbon::parse($invoice->invoice_date)->format('Y-m-d') }}</div>
            </div>
        </header>

        <section class="row g-3 mb-4">
            <div class="col-md-6">
                <div class="border rounded-3 p-3 h-100">
                    <h2 class="h6 text-secondary mb-2">العميل</h2>
                    <div class="fw-semibold">{{ $invoice->customer }}</div>
                    @if($invoice->notes)
                        <div class="small text-secondary mt-2">ملاحظات: {{ $invoice->notes }}</div>
                    @endif
                </div>
            </div>
            <div class="col-md-6">
                <div class="border rounded-3 p-3 h-100">
                    <h2 class="h6 text-secondary mb-2">حالة الفاتورة</h2>
                    <div class="fw-semibold">{{ $statusLabels[$invoice->status] ?? $invoice->status }}</div>
                </div>
            </div>
        </section>

        <div class="table-responsive mb-4">
            <table class="table table-bordered align-middle mb-0">
                <thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
                <tbody>
                    @foreach($items as $item)
                        <tr>
                            <td>{{ $item['name'] ?? '—' }}</td>
                            <td>{{ (int) ($item['quantity'] ?? 0) }}</td>
                            <td>{{ number_format((float) ($item['price'] ?? 0), 2) }}</td>
                            <td>{{ number_format((float) ($item['line_total'] ?? 0), 2) }}</td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
        </div>

        <section class="row justify-content-end">
            <dl class="col-md-6 row gy-2 mb-0">
                <dt class="col-6">الإجمالي</dt><dd class="col-6 text-end">{{ number_format((float) $invoice->total_amount, 2) }}</dd>
                <dt class="col-6">المدفوع</dt><dd class="col-6 text-end">{{ number_format((float) $invoice->paid_amount, 2) }}</dd>
                <dt class="col-6 border-top pt-2">المتبقي</dt><dd class="col-6 text-end border-top pt-2 fw-bold">{{ number_format($remaining, 2) }}</dd>
            </dl>
        </section>
    </article>
</div>
@endsection
