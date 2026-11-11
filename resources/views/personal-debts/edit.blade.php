@extends('layouts.app')
@section('title', ' - تعديل دين شخصي')

@section('content')
    <span class="text-center border border-1 rounded text-bold">تعديل دين شخصي</span>
    <form action="{{ route('personal-debts.update', $debt) }}" method="POST">
      @csrf
      @method('PUT')

      <div class="mb-3">
        <label for="creditor" class="form-label">الدائن</label>
        <input type="text" class="form-control @error('creditor') is-invalid @enderror" id="creditor" name="creditor" value="{{ old('creditor', $debt->creditor) }}" required maxlength="255">
        @error('creditor')<div class="invalid-feedback">{{ $message }}</div>@enderror
      </div>

      <div class="mb-3">
        <label for="description" class="form-label">الوصف</label>
        <input type="text" class="form-control @error('description') is-invalid @enderror" id="description" name="description" value="{{ old('description', $debt->description) }}" maxlength="255">
        @error('description')<div class="invalid-feedback">{{ $message }}</div>@enderror
      </div>

      <div class="row g-3 mb-3">
        <div class="col-md-4">
          <label for="total_amount" class="form-label">إجمالي الدين</label>
          <input type="number" step="0.01" min="0.01" class="form-control @error('total_amount') is-invalid @enderror" id="total_amount" name="total_amount" value="{{ old('total_amount', $debt->total_amount) }}" required>
          @error('total_amount')<div class="invalid-feedback">{{ $message }}</div>@enderror
        </div>
        <div class="col-md-4">
          <label class="form-label">المدفوع حتى الآن</label>
          <input type="number" class="form-control" value="{{ $debt->paid_amount }}" readonly>
        </div>
        <div class="col-md-4">
          <label for="due_date" class="form-label">تاريخ الاستحقاق</label>
          <input type="date" class="form-control @error('due_date') is-invalid @enderror" id="due_date" name="due_date" value="{{ old('due_date', optional($debt->due_date)->format('Y-m-d')) }}">
          @error('due_date')<div class="invalid-feedback">{{ $message }}</div>@enderror
        </div>
      </div>

      <div class="mb-3">
        <label for="notes" class="form-label">ملاحظات</label>
        <textarea class="form-control @error('notes') is-invalid @enderror" id="notes" name="notes" rows="3" maxlength="2000">{{ old('notes', $debt->notes) }}</textarea>
        @error('notes')<div class="invalid-feedback">{{ $message }}</div>@enderror
      </div>

      @include('components.form-actions', ['submitLabel' => 'حفظ التعديلات', 'backUrl' => route('installments.index')])
    </form>
@endsection
