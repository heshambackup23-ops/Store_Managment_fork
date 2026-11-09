@extends('layouts.app')

@section('main')
    @include('wallets._nav')
    @php $m = fn (int $cents) => \App\Support\Money::format($cents); @endphp

    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">المصروفات والخزينة</h3>
    </div>

    @if ($errors->any())
        <div class="alert alert-danger"><ul class="mb-0">@foreach ($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul></div>
    @endif

    <div class="row g-3 mb-3">
        <div class="col-md-6">
            <div class="card shadow-sm h-100"><div class="card-body">
                <div class="text-body-secondary small">النقدية المفروض وجودها في الدرج الآن</div>
                <div class="fs-3 fw-bold {{ $cash < 0 ? 'text-danger' : '' }}">{{ $m($cash) }} <small class="fs-6">ج.م</small></div>
                <div class="small text-body-secondary">= حركة العمليات + حركات الدرج - المصروفات</div>
            </div></div>
        </div>
        <div class="col-md-6">
            <div class="card shadow-sm h-100"><div class="card-body">
                <div class="text-body-secondary small">مصروفات الفترة ({{ $from }} إلى {{ $to }})</div>
                <div class="fs-3 fw-bold text-danger">{{ $m($rangeTotal) }} <small class="fs-6">ج.م</small></div>
            </div></div>
        </div>
    </div>

    @can('page.wallets.manage')
        <div class="row g-3 mb-3">
            <div class="col-lg-6">
                <form method="POST" action="{{ route('wallets.expenses.store') }}" class="card shadow-sm h-100" autocomplete="off">
                    @csrf
                    <div class="card-header fw-semibold">تسجيل مصروف</div>
                    <div class="card-body row g-2">
                        <div class="col-md-6">
                            <label for="category" class="form-label small mb-1">البند</label>
                            <input list="categoryList" id="category" name="category" class="form-control" maxlength="60" value="{{ old('category') }}" required>
                            <datalist id="categoryList">@foreach ($categories as $category)<option value="{{ $category }}">@endforeach</datalist>
                        </div>
                        <div class="col-md-6">
                            <label for="amount" class="form-label small mb-1">المبلغ (ج.م)</label>
                            <input type="text" id="amount" name="amount" dir="ltr" inputmode="decimal" class="form-control" value="{{ old('amount') }}" required>
                        </div>
                        <div class="col-md-6">
                            <label for="spent_on" class="form-label small mb-1">التاريخ</label>
                            <input type="date" id="spent_on" name="spent_on" class="form-control" max="{{ now()->toDateString() }}" value="{{ old('spent_on', now()->toDateString()) }}" required>
                        </div>
                        <div class="col-md-6">
                            <label for="note" class="form-label small mb-1">ملاحظة</label>
                            <input type="text" id="note" name="note" class="form-control" maxlength="500" value="{{ old('note') }}">
                        </div>
                    </div>
                    <div class="card-footer"><button class="btn btn-danger">حفظ المصروف</button></div>
                </form>
            </div>

            <div class="col-lg-6">
                <form method="POST" action="{{ route('wallets.cash.store') }}" class="card shadow-sm h-100" autocomplete="off">
                    @csrf
                    <div class="card-header fw-semibold">حركة في الدرج (بدون ربح)</div>
                    <div class="card-body row g-2">
                        <div class="col-md-6">
                            <label for="kind" class="form-label small mb-1">النوع</label>
                            <select id="kind" name="kind" class="form-select" required>
                                @foreach ($cashKinds as $key => $label)
                                    <option value="{{ $key }}" @selected(old('kind') === $key)>{{ $label }}</option>
                                @endforeach
                            </select>
                        </div>
                        <div class="col-md-6">
                            <label for="cash_amount" class="form-label small mb-1">المبلغ (ج.م)</label>
                            <input type="text" id="cash_amount" name="amount" dir="ltr" inputmode="decimal" class="form-control" required>
                        </div>
                        <div class="col-12">
                            <label for="cash_note" class="form-label small mb-1">ملاحظة</label>
                            <input type="text" id="cash_note" name="note" class="form-control" maxlength="500">
                        </div>
                        <div class="col-12 small text-body-secondary">
                            ابدأ بتسجيل "رصيد افتتاحي للدرج" بما في الدرج الآن، حتى يطابق النظام الواقع.
                        </div>
                    </div>
                    <div class="card-footer"><button class="btn btn-primary">حفظ الحركة</button></div>
                </form>
            </div>
        </div>
    @endcan

    <div class="row g-3 mb-3">
        <div class="col-lg-4">
            <div class="card shadow-sm h-100"><div class="card-body">
                <div class="text-body-secondary small">الأرباح المتاحة للسحب</div>
                <div class="fs-3 fw-bold {{ $profitAvailable < 0 ? 'text-danger' : 'text-success' }}">{{ $m($profitAvailable) }} <small class="fs-6">ج.م</small></div>
                <div class="small text-body-secondary">= العمولات - رسوم المزود - المصروفات - ما سُحب من الأرباح</div>
            </div></div>
        </div>
        @can('page.wallets.manage')
            <div class="col-lg-8">
                <form method="POST" action="{{ route('wallets.profit.store') }}" class="card shadow-sm h-100" autocomplete="off">
                    @csrf
                    <div class="card-header fw-semibold">سحب أرباح</div>
                    <div class="card-body row g-2">
                        <div class="col-md-5">
                            <label for="profit_source" class="form-label small mb-1">اسحب من</label>
                            <select id="profit_source" name="source" class="form-select" required>
                                <option value="cash">الدرج (نقدي)</option>
                                @foreach ($walletOptions as $option)
                                    <option value="wallet:{{ $option->id }}">{{ $option->label() }} (#{{ $option->id }}) - الرصيد {{ $m(\App\Support\Money::cents($option->balance)) }}</option>
                                @endforeach
                            </select>
                        </div>
                        <div class="col-md-3">
                            <label for="profit_amount" class="form-label small mb-1">المبلغ (ج.م)</label>
                            <input type="text" id="profit_amount" name="amount" dir="ltr" inputmode="decimal" class="form-control" required>
                        </div>
                        <div class="col-md-4">
                            <label for="profit_note" class="form-label small mb-1">ملاحظة</label>
                            <input type="text" id="profit_note" name="note" class="form-control" maxlength="500">
                        </div>
                        <div class="col-12 small text-body-secondary">لا يمكن سحب أكثر من الأرباح المتاحة. السحب لا يمس رأس المال التشغيلي.</div>
                    </div>
                    <div class="card-footer"><button class="btn btn-success">تسجيل سحب الأرباح</button></div>
                </form>
            </div>
        @endcan
    </div>

    <form method="GET" action="{{ route('wallets.expenses.index') }}" class="card shadow-sm mb-3">
        <div class="card-body row g-2 align-items-end">
            <div class="col-md-4"><label for="from" class="form-label small mb-1">من</label><input type="date" id="from" name="from" class="form-control" value="{{ $from }}"></div>
            <div class="col-md-4"><label for="to" class="form-label small mb-1">إلى</label><input type="date" id="to" name="to" class="form-control" value="{{ $to }}"></div>
            <div class="col-md-4"><button class="btn btn-outline-primary w-100">عرض</button></div>
        </div>
    </form>

    <div class="card shadow-sm mb-3">
        <div class="table-responsive">
            <table class="table table-sm align-middle mb-0">
                <thead><tr><th>التاريخ</th><th>البند</th><th>المبلغ</th><th>ملاحظة</th><th>سجّله</th><th>الحالة</th><th></th></tr></thead>
                <tbody>
                    @forelse ($expenses as $expense)
                        <tr class="{{ $expense->voided_at ? 'text-body-secondary' : '' }}">
                            <td class="text-nowrap">{{ $expense->spent_on->format('Y-m-d') }}</td>
                            <td>{{ $expense->category }}</td>
                            <td class="text-nowrap fw-semibold">{{ $m(\App\Support\Money::cents($expense->amount)) }}</td>
                            <td>{{ $expense->note }}</td>
                            <td class="small">{{ $expense->created_by_name }}</td>
                            <td>
                                @if ($expense->voided_at)
                                    <span class="badge text-bg-secondary" title="{{ $expense->void_reason }}">ملغي</span>
                                @else
                                    <span class="badge text-bg-success">مسجَّل</span>
                                @endif
                            </td>
                            <td>
                                @can('page.wallets.manage')
                                    @unless ($expense->voided_at)
                                        <button type="button" class="btn btn-sm btn-outline-danger" data-bs-toggle="modal" data-bs-target="#voidExpense"
                                                data-action="{{ route('wallets.expenses.void', $expense) }}" data-summary="{{ $expense->category }} - {{ $m(\App\Support\Money::cents($expense->amount)) }}">إلغاء</button>
                                    @endunless
                                @endcan
                            </td>
                        </tr>
                    @empty
                        <tr><td colspan="7" class="text-center text-body-secondary py-4">لا توجد مصروفات في هذه الفترة.</td></tr>
                    @endforelse
                </tbody>
            </table>
        </div>
        @if ($expenses->hasPages())<div class="card-footer">{{ $expenses->links() }}</div>@endif
    </div>

    <div class="card shadow-sm">
        <div class="card-header fw-semibold">آخر حركات الدرج</div>
        <div class="table-responsive">
            <table class="table table-sm mb-0">
                <thead><tr><th>الوقت</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th><th>سجّله</th></tr></thead>
                <tbody>
                    @forelse ($adjustments as $row)
                        <tr>
                            <td class="text-nowrap" dir="ltr">{{ $row->occurred_at->format('Y-m-d H:i') }}</td>
                            <td>{{ $kindLabels[$row->kind] ?? $row->kind }}</td>
                            <td class="text-nowrap fw-semibold {{ \App\Support\Money::cents($row->amount) < 0 ? 'text-danger' : 'text-success' }}">{{ $m(\App\Support\Money::cents($row->amount)) }}</td>
                            <td>{{ $row->note }}</td><td class="small">{{ $row->created_by_name }}</td>
                        </tr>
                    @empty
                        <tr><td colspan="5" class="text-center text-body-secondary py-3">لا توجد حركات.</td></tr>
                    @endforelse
                </tbody>
            </table>
        </div>
    </div>

    @can('page.wallets.manage')
        <div class="modal fade" id="voidExpense" tabindex="-1" aria-labelledby="voidExpenseTitle" aria-hidden="true">
            <div class="modal-dialog">
                <form method="POST" class="modal-content" id="voidExpenseForm">
                    @csrf
                    <div class="modal-header"><h5 class="modal-title" id="voidExpenseTitle">إلغاء مصروف</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="إغلاق"></button></div>
                    <div class="modal-body">
                        <p id="voidExpenseSummary" class="mb-2"></p>
                        <label for="voidExpenseReason" class="form-label">سبب الإلغاء</label>
                        <input type="text" id="voidExpenseReason" name="reason" class="form-control" minlength="3" maxlength="255" required>
                    </div>
                    <div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">تراجع</button><button class="btn btn-danger">تأكيد</button></div>
                </form>
            </div>
        </div>
    @endcan
@endsection

@push('scripts')
<script>
    document.getElementById('voidExpense')?.addEventListener('show.bs.modal', (event) => {
        const b = event.relatedTarget;
        document.getElementById('voidExpenseForm').action = b.dataset.action;
        document.getElementById('voidExpenseSummary').textContent = b.dataset.summary;
        document.getElementById('voidExpenseReason').value = '';
    });
</script>
@endpush
