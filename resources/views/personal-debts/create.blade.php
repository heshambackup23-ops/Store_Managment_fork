@extends('layouts.app')
@section('title', ' - دين شخصي جديد')

@section('content')
    <span class="text-center border border-1 rounded text-bold">تسجيل دين عليّ</span>
    <p class="text-secondary mt-2">استخدم هذا النموذج للمبالغ المستحقة عليك لشخص أو جهة خارج مبيعات المتجر.</p>
    <form action="{{ route('personal-debts.store') }}" method="POST">
      @csrf

      <div class="mb-3">
        <label for="creditor" class="form-label">الدائن</label>
        <input type="text" class="form-control @error('creditor') is-invalid @enderror" id="creditor" name="creditor" value="{{ old('creditor') }}" required maxlength="255">
        @error('creditor')<div class="invalid-feedback">{{ $message }}</div>@enderror
      </div>

      <div class="mb-3">
        <label for="description" class="form-label">الوصف</label>
        <input type="text" class="form-control @error('description') is-invalid @enderror" id="description" name="description" value="{{ old('description') }}" maxlength="255">
        @error('description')<div class="invalid-feedback">{{ $message }}</div>@enderror
      </div>

      <div class="row g-3 mb-3">
        <div class="col-md-4">
          <label for="total_amount" class="form-label">إجمالي الدين</label>
          <input type="number" step="0.01" min="0.01" class="form-control @error('total_amount') is-invalid @enderror" id="total_amount" name="total_amount" value="{{ old('total_amount') }}" required>
          @error('total_amount')<div class="invalid-feedback">{{ $message }}</div>@enderror
        </div>
        <div class="col-md-4">
          <label for="paid_amount" class="form-label">المدفوع الآن</label>
          <input type="number" step="0.01" min="0" class="form-control @error('paid_amount') is-invalid @enderror" id="paid_amount" name="paid_amount" value="{{ old('paid_amount', 0) }}">
          @error('paid_amount')<div class="invalid-feedback">{{ $message }}</div>@enderror
        </div>
        <div class="col-md-4">
          <label for="due_date" class="form-label">تاريخ الاستحقاق</label>
          <input type="date" class="form-control @error('due_date') is-invalid @enderror" id="due_date" name="due_date" value="{{ old('due_date') }}">
          @error('due_date')<div class="invalid-feedback">{{ $message }}</div>@enderror
        </div>
      </div>

      <div class="mb-3">
        <label for="notes" class="form-label">ملاحظات</label>
        <textarea class="form-control @error('notes') is-invalid @enderror" id="notes" name="notes" rows="3" maxlength="2000">{{ old('notes') }}</textarea>
        @error('notes')<div class="invalid-feedback">{{ $message }}</div>@enderror
      </div>

      @include('components.form-actions', ['submitLabel' => 'حفظ الدين', 'backUrl' => route('installments.index')])
    </form>
@endsection
