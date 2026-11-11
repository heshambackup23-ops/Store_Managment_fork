<!doctype html>
<html lang="ar" dir="rtl" data-bs-theme="light">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ملصق المنتج - {{ $product->name }}</title>
    @vite('resources/css/app.css')
    <style>
        body { min-height: 100vh; background: #f1f4f8; color: #172033; }
        .label-toolbar { max-width: 58mm; margin: 1rem auto; }
        .product-label {
            width: 58mm;
            height: 40mm;
            margin: 1rem auto;
            padding: 2.5mm;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            background: #fff;
            color: #111827;
            border: 1px dashed #94a3b8;
            box-sizing: border-box;
            font-family: "Cairo", Tahoma, sans-serif;
        }
        .label-name { font-size: 11pt; font-weight: 700; line-height: 1.2; max-height: 9mm; overflow: hidden; }
        .label-category { color: #475569; font-size: 7pt; line-height: 1.1; }
        .label-price { font-size: 12pt; font-weight: 700; white-space: nowrap; }
        .label-barcode { width: 100%; height: 12mm; }
        .label-code { font: 7pt Tahoma, sans-serif; direction: ltr; text-align: center; }
        @page { size: 58mm 40mm; margin: 0; }
        @media print {
            html, body { width: 58mm; height: 40mm; min-height: 0; margin: 0 !important; padding: 0 !important; background: #fff !important; }
            .no-print { display: none !important; }
            .product-label { width: 58mm; height: 40mm; margin: 0; border: 0; page-break-after: always; break-after: page; }
        }
    </style>
</head>
<body>
    <div class="label-toolbar d-flex justify-content-between gap-2 no-print">
        <a href="{{ route('products.index') }}" class="btn btn-outline-secondary btn-sm">العودة للمنتجات</a>
        <button type="button" class="btn btn-primary btn-sm" onclick="window.print()">طباعة الملصق</button>
    </div>

    <article class="product-label" aria-label="ملصق {{ $product->name }}">
        <div>
            <div class="label-name">{{ $product->name }}</div>
            @if($product->category?->name)
                <div class="label-category">{{ $product->category->name }}</div>
            @endif
        </div>
        <div class="label-price">{{ number_format((float) $product->price, 2) }} ج.م</div>
        <div>
            <svg id="barcode" class="label-barcode" role="img" aria-label="باركود المنتج"></svg>
            <div class="label-code">{{ $product->barcode ?? $product->id }}</div>
        </div>
    </article>

    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', () => {
            const barcode = document.getElementById('barcode');
            const value = @json((string) ($product->barcode ?? $product->id));
            if (barcode && value && window.JsBarcode) {
                JsBarcode(barcode, value, {
                    format: 'CODE128',
                    displayValue: false,
                    height: 36,
                    width: 1.5,
                    margin: 0,
                });
            }
        });
    </script>
</body>
</html>
