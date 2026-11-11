<!doctype html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <style>
        @page { margin: 28px; }
        body { font-family: "DejaVu Sans", sans-serif; color: #172033; font-size: 12px; direction: rtl; }
        .header { border-bottom: 2px solid #263b64; padding-bottom: 14px; margin-bottom: 18px; text-align: right; }
        .header h1 { color: #263b64; font-size: 22px; margin: 0 0 6px; }
        .muted { color: #64748b; }
        .grid { width: 100%; margin-bottom: 18px; }
        .grid td { width: 50%; background: #f4f6fa; padding: 12px; vertical-align: top; text-align: right; }
        table.items { width: 100%; border-collapse: collapse; margin: 14px 0 18px; }
        .items th, .items td { border: 1px solid #d7deea; padding: 9px; text-align: right; }
        .items th { background: #e9eef7; color: #263b64; }
        .totals { width: 45%; margin-right: auto; border-collapse: collapse; }
        .totals td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; }
        .status { margin-top: 16px; font-weight: bold; }
        .notes { margin-top: 20px; padding: 10px; background: #f8fafc; text-align: right; }
    </style>
</head>
<body>
@php
    $items = is_array($invoice->items) && count($invoice->items) > 0
        ? $invoice->items
        : [[
            'name' => $invoice->product?->name ?? '—',
            'quantity' => $invoice->quantity,
            'price' => $invoice->product_price,
            'line_total' => $invoice->total_amount,
        ]];
    $remaining = max(0, (float) $invoice->total_amount - (float) $invoice->paid_amount);
@endphp
<div class="header">
    <h1>Bebo</h1>
    <div class="muted">فاتورة بيع رقم {{ $invoice->invoice_number }}</div>
</div>
<table class="grid"><tr>
    <td><strong>العميل</strong><br>{{ $invoice->customer }}<br><span class="muted">التاريخ: {{ \Carbon\Carbon::parse($invoice->invoice_date)->format('Y-m-d') }}</span></td>
    <td><strong>حالة الفاتورة</strong><br>{{ ['paid' => 'مدفوعة', 'unpaid' => 'غير مدفوعة', 'refunded' => 'مستردة'][$invoice->status] ?? $invoice->status }}</td>
</tr></table>
<table class="items">
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
<table class="totals">
    <tr><td>الإجمالي</td><td>{{ number_format((float) $invoice->total_amount, 2) }}</td></tr>
    <tr><td>المدفوع</td><td>{{ number_format((float) $invoice->paid_amount, 2) }}</td></tr>
    <tr><td>المتبقي</td><td>{{ number_format($remaining, 2) }}</td></tr>
</table>
@if($invoice->notes)<div class="notes"><strong>ملاحظات:</strong> {{ $invoice->notes }}</div>@endif
</body>
</html>
