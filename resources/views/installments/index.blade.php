@extends('layouts.app')
@section('title', ' - الديون')

@section('content')

<div class="page-header d-flex flex-column flex-md-row justify-content-between align-items-start gap-3">
    <div>
        <h1>الديون</h1>
        @include('components.search-bar', ['placeholder' => 'اسم العميل أو الدائن'])
    </div>
    <div class="d-flex flex-wrap gap-2">
        <a href="{{ route('personal-debts.create') }}" class="btn btn-outline-primary btn-round">
            <i class="fas fa-hand-holding-usd me-1"></i> دين عليّ
        </a>
        <a href="{{ route('installments.create') }}" class="btn btn-primary btn-round">
            <i class="fas fa-plus me-1"></i> دين عميل
        </a>
    </div>
</div>

<div class="row gx-3 gy-3 mb-4">
    @isset($installments)
    <div class="col-12 col-md-6 col-xl-4">
        <div class="card border-0 shadow-sm bg-body p-3">
            <div class="d-flex align-items-center justify-content-between mb-2">
                <p class="text-muted small mb-0">ديون العملاء</p>
                <span class="badge bg-primary bg-opacity-10 text-primary">الصفحة الحالية</span>
            </div>
            <h2 class="fw-bold mb-1">{{ $installments->total() }}</h2>
            <p class="text-secondary mb-0">عرض {{ $installments->count() }} من أصل {{ $installments->total() }} دين عميل.</p>
        </div>
    </div>
    @endisset
    @isset($personalDebts)
    <div class="col-12 col-md-6 col-xl-4">
        <div class="card border-0 shadow-sm bg-body p-3">
            <div class="d-flex align-items-center justify-content-between mb-2">
                <p class="text-muted small mb-0">ديون عليّ</p>
                <span class="badge bg-warning bg-opacity-10 text-warning">مستحق للغير</span>
            </div>
            <h2 class="fw-bold mb-1">{{ $personalDebts->total() }}</h2>
            <p class="text-secondary mb-0">المبالغ التي تدين بها لأشخاص أو جهات خارج الأقساط.</p>
        </div>
    </div>
    @endisset
</div>

<div class="d-flex flex-wrap align-items-center gap-2 mb-3" role="group" aria-label="نوع الأقساط">
    <span class="fw-semibold me-1">عرض النوع:</span>
    <a class="btn btn-sm {{ $type === 'all' ? 'btn-primary' : 'btn-outline-primary' }}" href="{{ route('installments.index', array_filter(['type' => 'all', 'search' => request('search')])) }}">الكل</a>
    <a class="btn btn-sm {{ $type === 'customer' ? 'btn-primary' : 'btn-outline-primary' }}" href="{{ route('installments.index', array_filter(['type' => 'customer', 'search' => request('search')])) }}">أقساط العملاء</a>
    <a class="btn btn-sm {{ $type === 'personal' ? 'btn-primary' : 'btn-outline-primary' }}" href="{{ route('installments.index', array_filter(['type' => 'personal', 'search' => request('search')])) }}">الديون الشخصية</a>
</div>

@isset($installments)
<h2 class="h5 mb-3">أقساط العملاء</h2>
<div class="table-wrapper table-responsive mb-5">
    <table class="table table-hover table-striped align-middle mb-0">
      <thead class="table-dark">
        <tr>
          <th scope="col">#</th>
          <th scope="col">النوع</th>
          <th scope="col">الاسم</th>
          <th scope="col">المنتج</th>
          <th scope="col">المبلغ</th>
          <th scope="col">الكمية</th>
          <th scope="col">تاريخ الدفع</th>
          <th scope="col">الدفعه التالية</th>
          <th scope="col">المدفوع</th>
          <th scope="col">المتبقي</th>
          <th scope="col">الحالة</th>
          <th scope="col">ملاحظات</th>
          <th scope="col">الإجراءات</th>
        </tr>
      </thead>
      <tbody>
          @forelse($installments as $installment)
        <tr>
          <th scope="row">{{ $installment->id }}</th>
          <td><span class="badge text-bg-primary">قسط عميل</span></td>
          <td>{{ $installment->customer }}</td>
          <td>{{ $installment->item_names ?: ($installment->product?->name ?? 'لا يوجد اسم') }}</td>
          <td>{{ $installment->product?->price ?? $installment->product_price ?? 'لا يوجد سعر' }}</td>
          <td>{{ $installment->item_quantity ?: ($installment->quantity ?? 'لا يوجد كمية') }}</td>
          <td>{{ $installment->payment_date ? \Carbon\Carbon::parse($installment->payment_date)->format('Y-m-d') : '—' }}</td>
          <td>{{ $installment->next_payment_date ? \Carbon\Carbon::parse($installment->next_payment_date)->format('Y-m-d') : '—' }}</td>
          <td>{{ $installment->paid_amount }}</td>
          <td>{{ $installment->remaining }}</td>
          <td>{{ $installment->status }}</td>
          <td>{{ $installment->notes ?: '—' }}</td>
          <td>
              @unless($installment->invoice_id)
                  <a href="{{ route('installments.edit', $installment->id) }}" class="btn btn-sm btn-primary m-1 rounded">تعديل</a>
              @endunless
              @unless($installment->status === 'مكتمل' || (float) $installment->remaining <= 0)
                  <a href="{{ route('installments.showPay', $installment->id) }}" class="btn btn-sm btn-warning m-1 rounded">دفع</a>
              @endunless
              <form action="{{ route('installments.status', $installment) }}" method="POST" class="d-inline-flex align-items-center gap-1 m-1">
                  @csrf
                  @method('PUT')
                  <select name="status" class="form-select form-select-sm" style="width: 8.5rem;">
                      @foreach(['غير مكتمل', 'متأخر', 'مكتمل'] as $status)
                          <option value="{{ $status }}" @selected($installment->status === $status)>{{ $status }}</option>
                      @endforeach
                  </select>
                  <button type="submit" class="btn btn-sm btn-outline-secondary rounded">الحالة</button>
              </form>
              <form action="{{ route('installments.destroy', $installment->id) }}" method="POST" style="display: inline;">
                  @csrf
                  @method('DELETE')
                  <button type="submit" class="btn btn-sm btn-danger rounded" onclick="return confirm('هل أنت متأكد من حذف هذا الدين؟')">حذف</button>
              </form>
          </td>
        </tr>
        @empty
        <tr>
            <td colspan="13" class="text-center">لا توجد ديون عملاء.</td>
        </tr>
        @endforelse
      </tbody>
    </table>

    @include('components.pagination', ['collection' => $installments])
</div>
@endisset

@isset($personalDebts)
<h2 class="h5 mb-3">ديون عليّ</h2>
<div class="table-wrapper table-responsive">
    <table class="table table-hover table-striped align-middle mb-0">
      <thead class="table-dark">
        <tr>
          <th scope="col">#</th>
          <th scope="col">النوع</th>
          <th scope="col">الدائن</th>
          <th scope="col">الوصف</th>
          <th scope="col">الإجمالي</th>
          <th scope="col">المدفوع</th>
          <th scope="col">المتبقي</th>
          <th scope="col">الاستحقاق</th>
          <th scope="col">الحالة</th>
          <th scope="col">الإجراءات</th>
        </tr>
      </thead>
      <tbody>
          @forelse($personalDebts as $debt)
        <tr>
          <th scope="row">{{ $debt->id }}</th>
          <td><span class="badge text-bg-warning">دين شخصي</span></td>
          <td>{{ $debt->creditor }}</td>
          <td>{{ $debt->description ?: '—' }}</td>
          <td>{{ $debt->total_amount }}</td>
          <td>{{ $debt->paid_amount }}</td>
          <td>{{ $debt->remaining }}</td>
          <td>{{ optional($debt->due_date)->format('Y-m-d') ?: '—' }}</td>
          <td>{{ $debt->status === 'paid' ? 'مسدد' : 'مفتوح' }}</td>
          <td>
              <a href="{{ route('personal-debts.edit', $debt) }}" class="btn btn-sm btn-primary m-1 rounded">تعديل</a>
              @unless($debt->status === 'paid' || (float) $debt->remaining <= 0)
                  <a href="{{ route('personal-debts.showPay', $debt) }}" class="btn btn-sm btn-warning m-1 rounded">دفع</a>
              @endunless
              <form action="{{ route('personal-debts.destroy', $debt) }}" method="POST" style="display: inline;">
                  @csrf
                  @method('DELETE')
                  <button type="submit" class="btn btn-sm btn-danger rounded" onclick="return confirm('هل أنت متأكد من حذف هذا الدين الشخصي؟')">حذف</button>
              </form>
          </td>
        </tr>
        @empty
        <tr>
            <td colspan="10" class="text-center">لا توجد ديون شخصية مسجلة.</td>
        </tr>
        @endforelse
      </tbody>
    </table>

    @include('components.pagination', ['collection' => $personalDebts])
</div>
@endisset

@endsection
