<!doctype html>
<html lang="ar" dir="rtl" data-bs-theme="light">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title', 'Bebo | Invoice')</title>
    @vite('resources/css/app.css')
    <style>
        body { min-height: 100vh; background: #f1f4f8; color: #172033; }
        .invoice-paper { max-width: 820px; margin: 0 auto; background: #fff; color: #172033; }
        .invoice-paper .text-secondary { color: #596579 !important; }
        .invoice-paper .table { --bs-table-color: #172033; --bs-table-bg: #fff; --bs-table-border-color: #dbe2ea; }
        .invoice-paper .table thead th { background: #edf2f8; color: #263b64; }
        .invoice-brand { color: #263b64; letter-spacing: 0.04em; }
        .invoice-actions { max-width: 820px; margin: 0 auto 1rem; }
        @page { size: A4; margin: 0; }
        @media print {
            html, body { width: 210mm; min-height: 0; margin: 0 !important; background: #fff !important; }
            .no-print { display: none !important; }
            .invoice-paper { width: auto; max-width: none; margin: 12mm; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
            .invoice-paper .table { page-break-inside: auto; }
            .invoice-paper tr { page-break-inside: avoid; }
        }
    </style>
</head>
<body>
    @yield('content')
</body>
</html>
