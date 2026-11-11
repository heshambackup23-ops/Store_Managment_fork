@extends('layouts.app')

@section('main')
    @include('wallets._nav')
    @php
        $m = fn (int $cents) => \App\Support\Money::format($cents);
        $canOperate = auth()->user()->can('page.wallet_cashier.manage');
    @endphp

    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">الآجل (مستحقات على العملاء)</h3>
        <span class="badge text-bg-warning fs-6">الإجمالي: {{ $m($total) }} ج.م</span>
    </div>

    @if ($errors->any())
        <div class="alert alert-danger"><ul class="mb-0">@foreach ($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul></div>
    @endif

    @if ($truncated)
        <div class="alert alert-info">يعرض هذا الجدول أقدم 500 عملية آجلة فقط. الإجمالي أعلاه كامل. حصّل الأقدم أولاً لتظهر الباقي.</div>
    @endif

    @if ($customers->hasPages())
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
            <small class="text-body-secondary">عرض {{ $customers->firstItem() }} إلى {{ $customers->lastItem() }} من {{ $customers->total() }} عميل</small>
            {{ $customers->links() }}
        </div>
    @endif

    @forelse ($groups as $customer => $rows)
        @php $sum = \App\Support\Money::cents($rows->sum('receivable')); @endphp
        <div class="card shadow-sm mb-3">
            <div class="card-header d-flex justify-content-between align-items-center">
                <span class="fw-semibold">{{ $customer }}</span>
                <span class="badge text-bg-warning">عليه {{ $m($sum) }} ج.م</span>
            </div>
            <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                    <thead><tr><th>التاريخ</th><th>المحفظة</th><th>الرقم</th><th>المبلغ</th><th>المتبقي</th><th></th></tr></thead>
                    <tbody>
                        @foreach ($rows as $row)
                            <tr>
                                <td class="text-nowrap" dir="ltr">{{ $row->occurred_at->format('Y-m-d H:i') }}</td>
                                <td>{{ $row->wallet?->label() }}</td>
                                <td dir="ltr">{{ $row->counterparty }}</td>
                                <td>{{ $m(\App\Support\Money::cents($row->amount) + \App\Support\Money::cents($row->commission)) }}</td>
                                <td class="fw-semibold">{{ $m(\App\Support\Money::cents($row->receivable)) }}</td>
                                <td>
                                    @if ($canOperate)
                                        <button type="button" class="btn btn-sm btn-outline-warning" data-bs-toggle="modal" data-bs-target="#settleModal"
                                                data-action="{{ route('wallet_cashier.settle', $row) }}" data-customer="{{ $customer }}"
                                                data-outstanding="{{ number_format(\App\Support\Money::cents($row->receivable) / 100, 2, '.', '') }}">تحصيل</button>
                                    @endif
                                </td>
                            </tr>
                        @endforeach
                    </tbody>
                </table>
            </div>
        </div>
    @empty
        <div class="card"><div class="card-body text-center text-body-secondary py-5">لا توجد مبالغ آجلة. كل العملاء مسدّدون.</div></div>
    @endforelse

    @if ($customers->hasPages())
        <div class="d-flex justify-content-end mt-3">{{ $customers->links() }}</div>
    @endif

    <div class="modal fade" id="settleModal" tabindex="-1" aria-labelledby="settleTitle" aria-hidden="true">
        <div class="modal-dialog">
            <form method="POST" class="modal-content" id="settleForm">
                @csrf
                <div class="modal-header"><h5 class="modal-title" id="settleTitle">تحصيل مبلغ آجل</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="إغلاق"></button></div>
                <div class="modal-body">
                    <p class="mb-2">العميل: <strong id="settleCustomer"></strong></p>
                    <label for="settleAmount" class="form-label">المبلغ المحصَّل (ج.م)</label>
                    <input type="text" id="settleAmount" name="amount" class="form-control" dir="ltr" inputmode="decimal" required>
                    <div class="form-text">يمكن تحصيل جزء. المتبقي: <span id="settleOutstanding"></span> ج.م</div>
                </div>
                <div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">إلغاء</button><button class="btn btn-warning">تسجيل التحصيل</button></div>
            </form>
        </div>
    </div>
@endsection

@push('scripts')
<script>
    document.getElementById('settleModal')?.addEventListener('show.bs.modal', (event) => {
        const b = event.relatedTarget;
        document.getElementById('settleForm').action = b.dataset.action;
        document.getElementById('settleCustomer').textContent = b.dataset.customer || '-';
        document.getElementById('settleOutstanding').textContent = b.dataset.outstanding;
        document.getElementById('settleAmount').value = b.dataset.outstanding;
    });
</script>
@endpush
