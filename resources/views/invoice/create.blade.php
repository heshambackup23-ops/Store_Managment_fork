@extends('layouts.app')

@section('content')

@php
    $invoiceItems = [];
    if (old('product_ids')) {
        $oldProductIds = old('product_ids');
        $oldQuantities = old('quantities', []);
        foreach ($oldProductIds as $index => $productId) {
            $product = $products->firstWhere('id', $productId);
            $invoiceItems[] = [
                'product_id' => $productId,
                'quantity'   => intval($oldQuantities[$index] ?? 1),
                'price'      => $product?->price ?? 0,
                'name'       => $product?->name ?? '',
            ];
        }
    } else {
        $invoiceItems[] = ['product_id' => '', 'quantity' => 1, 'price' => 0, 'name' => ''];
    }
@endphp

    <span class="text-center border border-1 rounded text-bold">انشاء فاتورة</span>
    <form action="{{ route('invoices.store') }}" method="POST">
      @csrf


      <div class="mb-3">
        <label for="customer" class="form-label">العميل</label>
        <input type="text" class="form-control" id="customer" name="customer" value="{{ old('customer') }}">
      </div>

      <div class="mb-3">
        <label for="notes" class="form-label">ملاحظات</label>
        <textarea class="form-control @error('notes') is-invalid @enderror" id="notes" name="notes" rows="3" maxlength="2000">{{ old('notes') }}</textarea>
        @error('notes')<div class="invalid-feedback">{{ $message }}</div>@enderror
      </div>

      <div class="mb-3">
        <label for="barcode" class="form-label">باركود (اختياري)</label>
        <input type="text" class="form-control" id="barcode" name="barcode" placeholder="امسح الباركود ثم اضغط Enter للاضافة" autofocus>
      </div>

      <div class="mb-4">
        <div class="d-flex align-items-center justify-content-between mb-2">
          <label class="form-label mb-0">المنتجات</label>
          <button type="button" class="btn btn-sm btn-outline-primary" id="addInvoiceItemBtn">إضافة منتج</button>
        </div>
        <div id="invoice-items-container"></div>
      </div>

      <div class="row g-3 mb-3">
        <div class="col-md-4">
          <label for="total_quantity" class="form-label">الكمية الإجمالية</label>
          <input type="number" readonly class="form-control" id="total_quantity" name="quantity" value="{{ old('quantity', 0) }}">
        </div>
        <div class="col-md-4">
          <label for="invoice_date" class="form-label">التاريخ</label>
          <input type="date" class="form-control" id="invoice_date" name="invoice_date" value="{{ old('invoice_date') }}">
        </div>
        <div class="col-md-4">
          <label for="paid_amount" class="form-label">المبلغ المدفوع</label>
          <input type="number" class="form-control" id="paid_amount" name="paid_amount" value="{{ old('paid_amount', 0) }}">
        </div>
      </div>

      <div class="mb-3">
        <label for="total_amount" class="form-label">المبلغ الكلي</label>
        <input type="number" readonly class="form-control" id="total_amount" name="total_amount" value="{{ old('total_amount', 0) }}">
      </div>

      @include('components.form-actions', ['submitLabel' => 'انشاء', 'backUrl' => route('invoices.index')])
    </form>

      @include('invoice._product-picker-script')
@endsection
