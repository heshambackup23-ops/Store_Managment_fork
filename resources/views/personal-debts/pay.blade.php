@extends('layouts.app')
@section('title', ' - سداد دين شخصي')

@section('content')
    <span class="text-center border border-1 rounded text-bold">سداد دين شخصي</span>
    <form action="{{ route('personal-debts.pay', $debt) }}" method="POST">
      @csrf
      @method('PUT')

      <div class="mb-3">
        <label class="form-label">الدائن</label>
        <input type="text" class="form-control" value="{{ $debt->creditor }}" readonly>
      </div>

      <div class="mb-3">
        <label class="form-label">إجمالي المدفوع سابقاً</label>
        <input type="number" class="form-control" value="{{ $debt->paid_amount }}" readonly>
      </div>

      <div class="mb-3">
        <label class="form-label">المتبقي الحالي</label>
        <input type="number" class="form-control" value="{{ $debt->remaining }}" readonly>
      </div>

      <div class="mb-3">
        <label for="amount" class="form-label">المبلغ المدفوع الآن</label>
        <input type="number" step="0.01" min="0.01" max="{{ $debt->remaining }}" class="form-control @error('amount') is-invalid @enderror" id="amount" name="amount" value="{{ old('amount') }}" required>
        @error('amount')<div class="invalid-feedback">{{ $message }}</div>@enderror
      </div>

      <div class="mb-3">
        <label for="remaining_after" class="form-label">المتبقي بعد الدفع</label>
        <input type="number" class="form-control" id="remaining_after" value="{{ $debt->remaining }}" readonly>
      </div>

      <div class="mb-3">
        <label for="notes" class="form-label">ملاحظة الدفعة</label>
        <input type="text" class="form-control @error('notes') is-invalid @enderror" id="notes" name="notes" value="{{ old('notes') }}" maxlength="500">
        @error('notes')<div class="invalid-feedback">{{ $message }}</div>@enderror
      </div>

      @include('components.form-actions', ['submitLabel' => 'تسجيل الدفعة', 'backUrl' => route('installments.index')])
    </form>
    @push('scripts')
    <script>
      document.getElementById('amount').addEventListener('input', function () {
          const currentRemaining = {{ (float) $debt->remaining }};
          const payNow = parseFloat(this.value) || 0;
          document.getElementById('remaining_after').value = (currentRemaining - payNow).toFixed(2);
      });
    </script>
    @endpush
@endsection
