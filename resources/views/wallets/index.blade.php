@extends('layouts.app')

@section('main')
    @include('wallets._nav')
    @php
        $barClass = ['ok' => 'bg-success', 'warn' => 'bg-warning', 'full' => 'bg-danger', 'none' => 'bg-secondary'];
        $money = fn (int $cents) => \App\Support\Money::format($cents);
    @endphp

    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0 d-flex align-items-center gap-2">
            <i class="fa-solid fa-wallet" aria-hidden="true"></i>
            <span>المحافظ الإلكترونية</span>
        </h3>
        @can('page.wallets.manage')
            <a href="{{ route('wallets.create') }}" class="btn btn-primary">
                <i class="fa-solid fa-plus" aria-hidden="true"></i> إضافة محفظة
            </a>
        @endcan
    </div>

    @if ($errors->any())
        <div class="alert alert-danger">
            <ul class="mb-0">@foreach ($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul>
        </div>
    @endif

    @if ($timezoneWarning)
        <div class="alert alert-danger" role="alert">
            المنطقة الزمنية للنظام UTC، فتتجدد الحدود اليومية والشهرية في توقيت خاطئ. اضبط <code dir="ltr">APP_TIMEZONE=Africa/Cairo</code> في ملف .env ثم نفّذ <code dir="ltr">php artisan optimize:clear</code>.
        </div>
    @endif

    <div class="row row-cols-2 row-cols-lg-5 g-3 mb-2">
        @foreach ([
            ['أرصدة المحافظ', $summary['wallets_total'], ''],
            ['النقدية في الدرج', $summary['cash'], $summary['cash'] < 0 ? 'text-danger' : ''],
            ['الأرباح المتاحة للسحب', $summary['profit_available'], $summary['profit_available'] < 0 ? 'text-danger' : 'text-success'],
            ['رأس المال التشغيلي', $summary['capital'], ''],
            ['ربح اليوم', $summary['profit_today'], 'text-success'],
        ] as [$label, $value, $class])
            <div class="col">
                <div class="card shadow-sm h-100"><div class="card-body">
                    <div class="text-body-secondary small">{{ $label }}</div>
                    <div class="fs-5 fw-bold {{ $class }}">{{ $money($value) }} <small class="fs-6">ج.م</small></div>
                </div></div>
            </div>
        @endforeach
    </div>
    <div class="small text-body-secondary mb-4">
        العمولة تُحسب ربحاً مستقلاً ولا تُخصم من رصيد المحفظة ولا تُضاف إلى رأس المال، ورصيد المحفظة يطابق تطبيق المزود.
        رأس المال التشغيلي = أرصدة المحافظ + النقدية + المستحق على العملاء - الأرباح المتاحة.
    </div>

    <div class="alert alert-warning py-2 small">
        <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
        لا تُدخل أبداً الرقم السري للمحفظة أو أكواد التحقق في هذا النظام. النظام يسجّل الحركة فقط ولا يتصل بالمحافظ.
    </div>

    <div class="row g-3">
        @forelse ($cards as $card)
            @php $wallet = $card['wallet']; @endphp
            <div class="col-lg-6">
                <div class="card shadow-sm h-100 {{ $wallet->is_active ? '' : 'opacity-75' }}">
                    <div class="card-header d-flex justify-content-between align-items-center gap-2">
                        <div class="d-flex flex-column">
                            <span class="fw-bold">{{ $wallet->label() }}</span>
                            <small class="text-body-secondary">#{{ $wallet->id }}@if ($wallet->providerLabel() !== '') &middot; {{ $wallet->providerLabel() }}@endif @if ($wallet->identifier) &middot; <span dir="ltr">{{ $wallet->identifier }}</span>@endif</small>
                        </div>
                        <span class="badge {{ $wallet->is_active ? 'text-bg-success' : 'text-bg-secondary' }}">
                            {{ $wallet->is_active ? 'نشطة' : 'موقوفة' }}
                        </span>
                    </div>
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-baseline mb-3">
                            <span class="text-body-secondary">الرصيد الحالي</span>
                            <span class="fs-4 fw-bold">{{ $money(\App\Support\Money::cents($wallet->balance)) }} <small class="fs-6">ج.م</small></span>
                        </div>

                        @foreach ($card['rows'] as $row)
                            <div class="mb-2">
                                <div class="d-flex justify-content-between small">
                                    <span>{{ $row['label'] }}</span>
                                    @if ($row['limit'] === null)
                                        <span class="text-body-secondary">بدون حد</span>
                                    @else
                                        <span>
                                            {{ $money($row['used']) }} / {{ $money($row['limit']) }}
                                            <span class="text-body-secondary">(المتبقي {{ $money($row['remaining']) }})</span>
                                        </span>
                                    @endif
                                </div>
                                @if ($row['limit'] !== null)
                                    <div class="progress" style="height:.5rem" role="progressbar"
                                         aria-label="{{ $row['label'] }}" aria-valuenow="{{ $row['percent'] }}" aria-valuemin="0" aria-valuemax="100">
                                        <div class="progress-bar {{ $barClass[$row['level']] }}" style="width: {{ $row['percent'] }}%"></div>
                                    </div>
                                    @if ($row['level'] === 'warn')
                                        <div class="small text-warning-emphasis">اقتربت من الحد</div>
                                    @elseif ($row['level'] === 'full')
                                        <div class="small text-danger">وصلت للحد الأقصى</div>
                                    @endif
                                @endif
                            </div>
                        @endforeach
                    </div>
                    <div class="card-footer d-flex flex-wrap gap-2">
                        @can('page.wallet_cashier.view')
                            @if ($wallet->is_active)
                                <a href="{{ route('wallet_cashier.index', ['wallet' => $wallet->id]) }}" class="btn btn-sm btn-success">
                                    <i class="fa-solid fa-cash-register" aria-hidden="true"></i> كاشير
                                </a>
                            @endif
                        @endcan
                        @can('page.wallets.manage')
                            <a href="{{ route('wallets.edit', $wallet) }}" class="btn btn-sm btn-outline-primary">تعديل</a>
                            <button type="button" class="btn btn-sm btn-outline-secondary"
                                    data-bs-toggle="modal" data-bs-target="#adjustModal"
                                    data-wallet="{{ $wallet->label() }}" data-action="{{ route('wallets.adjust', $wallet) }}">
                                تسوية الرصيد
                            </button>
                            <form method="POST" action="{{ route('wallets.toggle', $wallet) }}" class="ms-auto"
                                  onsubmit="return confirm('{{ $wallet->is_active ? 'إيقاف هذه المحفظة؟' : 'تفعيل هذه المحفظة؟' }}')">
                                @csrf
                                <button class="btn btn-sm {{ $wallet->is_active ? 'btn-outline-danger' : 'btn-outline-success' }}">
                                    {{ $wallet->is_active ? 'إيقاف' : 'تفعيل' }}
                                </button>
                            </form>
                        @endcan
                    </div>
                </div>
            </div>
        @empty
            <div class="col-12">
                <div class="card"><div class="card-body text-center text-body-secondary py-5">
                    لا توجد محافظ بعد. أضف أول محفظة لتبدأ.
                </div></div>
            </div>
        @endforelse
    </div>

    @if ($cards->hasPages())
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-3">
            <small class="text-body-secondary">عرض {{ $cards->firstItem() }} إلى {{ $cards->lastItem() }} من {{ $cards->total() }} محفظة</small>
            {{ $cards->links() }}
        </div>
    @endif

    @can('page.wallets.manage')
        <div class="modal fade" id="adjustModal" tabindex="-1" aria-labelledby="adjustTitle" aria-hidden="true">
            <div class="modal-dialog">
                <form method="POST" class="modal-content" id="adjustForm">
                    @csrf
                    <div class="modal-header">
                        <h5 class="modal-title" id="adjustTitle">تسوية رصيد: <span id="adjustWallet"></span></h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="إغلاق"></button>
                    </div>
                    <div class="modal-body">
                        <p class="small text-body-secondary">
                            استخدمها فقط لمطابقة الرصيد مع تطبيق المحفظة الفعلي. اكتب مبلغاً موجباً للزيادة أو سالباً للنقص.
                            تُسجَّل التسوية في السجل ولا يمكن حذفها.
                        </p>
                        <label for="adjustAmount" class="form-label">المبلغ (+ أو -)</label>
                        <input type="text" inputmode="decimal" class="form-control mb-3" id="adjustAmount" name="amount" required dir="ltr">
                        <label for="adjustReason" class="form-label">السبب</label>
                        <input type="text" class="form-control" id="adjustReason" name="reason" minlength="3" maxlength="255" required>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">إلغاء</button>
                        <button type="submit" class="btn btn-primary">حفظ التسوية</button>
                    </div>
                </form>
            </div>
        </div>
    @endcan
@endsection

@push('scripts')
<script>
    document.getElementById('adjustModal')?.addEventListener('show.bs.modal', (event) => {
        const button = event.relatedTarget;
        document.getElementById('adjustForm').action = button.dataset.action;
        document.getElementById('adjustWallet').textContent = button.dataset.wallet;
        document.getElementById('adjustAmount').value = '';
        document.getElementById('adjustReason').value = '';
    });
</script>
@endpush
