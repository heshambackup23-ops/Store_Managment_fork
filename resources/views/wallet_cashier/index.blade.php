@extends('layouts.app')

@section('main')
    @include('wallets._nav')
    @php
        $canOperate = auth()->user()->can('page.wallet_cashier.manage');
        $canReverse = auth()->user()->can('page.wallets.manage');
        $money = fn ($value) => \App\Support\Money::format(\App\Support\Money::cents($value));
    @endphp

    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0 d-flex align-items-center gap-2">
            <i class="fa-solid fa-cash-register" aria-hidden="true"></i>
            <span>كاشير المحافظ</span>
        </h3>
        @if ($outstanding > 0)
            <span class="badge text-bg-warning fs-6">مستحقات آجلة على العملاء: {{ \App\Support\Money::format($outstanding) }} ج.م</span>
        @endif
    </div>

    @if ($errors->any())
        <div class="alert alert-danger" role="alert">
            <ul class="mb-0">@foreach ($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul>
        </div>
    @endif

    @if (count($walletData) === 0)
        <div class="alert alert-info">
            لا توجد محافظ نشطة.
            @can('page.wallets.manage')
                <a href="{{ route('wallets.create') }}" class="alert-link">أضف محفظة</a>
            @endcan
        </div>
    @else
        <div class="row g-3">
            {{-- ================= Transaction form ================= --}}
            <div class="col-lg-7">
                <div class="card shadow-sm">
                    <div class="card-body">
                        @if (! $canOperate)
                            <div class="alert alert-secondary mb-3">لديك صلاحية العرض فقط. لا يمكنك تسجيل عمليات.</div>
                        @endif

                        <form method="POST" action="{{ route('wallet_cashier.store') }}" id="txnForm" autocomplete="off" novalidate>
                            @csrf
                            <input type="hidden" name="wallet_id" id="walletId" value="{{ old('wallet_id', $selectedWallet) }}">
                            <input type="hidden" name="type" id="txnType" value="{{ old('type', $selectedType) }}">
                            <input type="hidden" name="idempotency_key" id="idemKey" value="{{ old('idempotency_key') }}">

                            <div class="mb-3">
                                <div class="form-label fw-semibold">المحفظة</div>
                                <div class="d-flex flex-wrap gap-2" id="walletPicker" role="group" aria-label="اختيار المحفظة">
                                    @foreach ($walletData as $wallet)
                                        <button type="button" class="btn btn-outline-primary text-start" data-wallet-id="{{ $wallet['id'] }}">
                                            <span class="d-block fw-semibold">{{ $wallet['name'] }}</span>
                                            <small class="d-block" dir="auto">#{{ $wallet['id'] }} &middot; {{ collect([$wallet['provider'], $wallet['identifier']])->filter()->implode(' · ') }}</small>
                                            <small class="d-block">الرصيد: {{ \App\Support\Money::format($wallet['balance']) }}</small>
                                        </button>
                                    @endforeach
                                </div>
                            </div>

                            <div class="mb-3">
                                <div class="form-label fw-semibold">نوع العملية</div>
                                <div class="btn-group w-100" role="group" aria-label="نوع العملية">
                                    <button type="button" class="btn btn-outline-primary" data-type="send">
                                        <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                                        تحويل (العميل يدفع كاش)
                                    </button>
                                    <button type="button" class="btn btn-outline-success" data-type="receive">
                                        <i class="fa-solid fa-hand-holding-dollar" aria-hidden="true"></i>
                                        استلام / سحب نقدي (أدفع للعميل)
                                    </button>
                                </div>
                            </div>

                            <div class="row g-3">
                                <div class="col-md-6">
                                    <label for="counterparty" class="form-label" id="counterpartyLabel">رقم المستلم</label>
                                    <input type="text" id="counterparty" name="counterparty" dir="ltr" inputmode="tel" maxlength="64"
                                           class="form-control form-control-lg @error('counterparty') is-invalid @enderror"
                                           value="{{ old('counterparty') }}" placeholder="رقم الهاتف" required>
                                    <div class="form-text">أي رقم هاتف (محمول أو أرضي أو دولي)، أو عنوان إنستا باي.</div>
                                    @error('counterparty')<div class="invalid-feedback">{{ $message }}</div>@enderror
                                </div>
                                <div class="col-md-6">
                                    <label for="amount" class="form-label">المبلغ (ج.م)</label>
                                    <input type="text" id="amount" name="amount" dir="ltr" inputmode="decimal"
                                           class="form-control form-control-lg @error('amount') is-invalid @enderror"
                                           value="{{ old('amount') }}" placeholder="0.00" required autofocus>
                                    @error('amount')<div class="invalid-feedback">{{ $message }}</div>@enderror
                                </div>
                                <div class="col-md-6">
                                    <label for="commission" class="form-label">عمولتك (ج.م)</label>
                                    <input type="text" id="commission" name="commission" dir="ltr" inputmode="decimal"
                                           class="form-control @error('commission') is-invalid @enderror"
                                           value="{{ old('commission') }}" placeholder="0.00" @if (old('commission') !== null) data-touched="1" @endif>
                                    <div class="form-text" id="commissionHint"></div>
                                    @error('commission')<div class="invalid-feedback">{{ $message }}</div>@enderror
                                </div>
                                <div class="col-md-6">
                                    <label for="fee" class="form-label">رسوم المزود على المحفظة (ج.م)</label>
                                    <input type="text" id="fee" name="fee" dir="ltr" inputmode="decimal"
                                           class="form-control @error('fee') is-invalid @enderror"
                                           value="{{ old('fee') }}" placeholder="0.00" @if (old('fee') !== null) data-touched="1" @endif>
                                    <div class="form-text">تُخصم من رصيد المحفظة وتقل من ربحك.</div>
                                    @error('fee')<div class="invalid-feedback">{{ $message }}</div>@enderror
                                </div>

                                <div class="col-12" id="paymentBox">
                                    <div class="form-label fw-semibold">طريقة الدفع</div>
                                    <div class="d-flex gap-4">
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="payment_method" id="payCash" value="cash"
                                                   @checked(old('payment_method', 'cash') === 'cash')>
                                            <label class="form-check-label" for="payCash">نقدي</label>
                                        </div>
                                        <div class="form-check">
                                            <input class="form-check-input" type="radio" name="payment_method" id="payDeferred" value="deferred"
                                                   @checked(old('payment_method') === 'deferred')>
                                            <label class="form-check-label" for="payDeferred">آجل (العميل يدفع لاحقاً)</label>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-md-6">
                                    <label for="customer_name" class="form-label">اسم العميل</label>
                                    <input type="text" id="customer_name" name="customer_name" maxlength="120"
                                           class="form-control @error('customer_name') is-invalid @enderror"
                                           value="{{ old('customer_name') }}" placeholder="اختياري، ومطلوب للآجل">
                                    @error('customer_name')<div class="invalid-feedback">{{ $message }}</div>@enderror
                                </div>
                                <div class="col-md-6">
                                    <label for="notes" class="form-label">ملاحظات</label>
                                    <input type="text" id="notes" name="notes" maxlength="500" class="form-control" value="{{ old('notes') }}">
                                </div>
                            </div>

                            <button type="submit" class="btn btn-success btn-lg w-100 mt-4" id="submitBtn" disabled>
                                <i class="fa-solid fa-check" aria-hidden="true"></i>
                                <span>تنفيذ العملية</span>
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            {{-- ================= Live preview ================= --}}
            <div class="col-lg-5">
                <div class="card shadow-sm" aria-live="polite">
                    <div class="card-header fw-semibold">ملخص قبل التنفيذ</div>
                    <div class="card-body" id="preview"></div>
                </div>
            </div>
        </div>

        {{-- ================= Recent transactions ================= --}}
        <div class="card shadow-sm mt-4">
            <div class="card-header fw-semibold">آخر العمليات</div>
            <div class="table-responsive">
                <table class="table table-sm align-middle mb-0">
                    <thead>
                        <tr>
                            <th>الوقت</th><th>المحفظة</th><th>النوع</th><th>الرقم</th>
                            <th>المبلغ</th><th>العمولة</th><th>العميل</th><th>الحالة</th><th><span class="visually-hidden">إجراءات</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse ($recent as $tx)
                            @php $left = \App\Support\Money::cents($tx->receivable); @endphp
                            <tr class="{{ $tx->status === 'reversed' ? 'text-body-secondary' : '' }}">
                                <td class="text-nowrap" dir="ltr">{{ $tx->occurred_at->format('Y-m-d H:i') }}</td>
                                <td>{{ $tx->wallet?->label() }}</td>
                                <td>
                                    @if ($tx->type === 'send')
                                        <span class="badge text-bg-primary">تحويل</span>
                                    @else
                                        <span class="badge text-bg-success">استلام</span>
                                    @endif
                                </td>
                                <td dir="ltr">{{ $tx->counterparty }}</td>
                                <td class="text-nowrap fw-semibold">{{ $money($tx->amount) }}</td>
                                <td class="text-nowrap">{{ $money($tx->commission) }}</td>
                                <td>{{ $tx->customer_name }}</td>
                                <td>
                                    @if ($tx->status === 'reversed')
                                        <span class="badge text-bg-secondary" title="{{ $tx->reversal_reason }}">معكوسة</span>
                                    @elseif ($tx->payment_method === 'deferred')
                                        @if ($left > 0)
                                            <span class="badge text-bg-warning">آجل: {{ \App\Support\Money::format($left) }}</span>
                                        @else
                                            <span class="badge text-bg-success">تم التحصيل</span>
                                        @endif
                                    @else
                                        <span class="badge text-bg-light border text-dark">نقدي</span>
                                    @endif
                                </td>
                                <td class="text-nowrap">
                                    @if ($tx->status === 'completed' && $left > 0 && $canOperate)
                                        <button type="button" class="btn btn-sm btn-outline-warning"
                                                data-bs-toggle="modal" data-bs-target="#settleModal"
                                                data-action="{{ route('wallet_cashier.settle', $tx) }}"
                                                data-customer="{{ $tx->customer_name }}"
                                                data-outstanding="{{ number_format($left / 100, 2, '.', '') }}">تحصيل</button>
                                    @endif
                                    @if ($tx->status === 'completed' && $canReverse)
                                        <button type="button" class="btn btn-sm btn-outline-danger"
                                                data-bs-toggle="modal" data-bs-target="#reverseModal"
                                                data-action="{{ route('wallet_cashier.reverse', $tx) }}"
                                                data-summary="{{ $tx->type === 'send' ? 'تحويل' : 'استلام' }} {{ $money($tx->amount) }} ({{ $tx->counterparty }})">عكس</button>
                                    @endif
                                </td>
                            </tr>
                        @empty
                            <tr><td colspan="9" class="text-center text-body-secondary py-4">لا توجد عمليات بعد.</td></tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
        </div>

        {{-- Reverse modal --}}
        <div class="modal fade" id="reverseModal" tabindex="-1" aria-labelledby="reverseTitle" aria-hidden="true">
            <div class="modal-dialog">
                <form method="POST" class="modal-content" id="reverseForm">
                    @csrf
                    <div class="modal-header">
                        <h5 class="modal-title" id="reverseTitle">عكس العملية</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="إغلاق"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-2" id="reverseSummary"></p>
                        <p class="small text-body-secondary">
                            لا يُحذف أي سجل. تُعلَّم العملية "معكوسة" ويُضاف قيد عكسي يعيد الرصيد والنقدية والحد المستهلك.
                        </p>
                        <label for="reverseReason" class="form-label">سبب العكس</label>
                        <input type="text" class="form-control" id="reverseReason" name="reason" minlength="3" maxlength="255" required>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">إلغاء</button>
                        <button type="submit" class="btn btn-danger">تأكيد العكس</button>
                    </div>
                </form>
            </div>
        </div>

        {{-- Settle modal --}}
        <div class="modal fade" id="settleModal" tabindex="-1" aria-labelledby="settleTitle" aria-hidden="true">
            <div class="modal-dialog">
                <form method="POST" class="modal-content" id="settleForm">
                    @csrf
                    <div class="modal-header">
                        <h5 class="modal-title" id="settleTitle">تحصيل مبلغ آجل</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="إغلاق"></button>
                    </div>
                    <div class="modal-body">
                        <p class="mb-2">العميل: <strong id="settleCustomer"></strong></p>
                        <label for="settleAmount" class="form-label">المبلغ المحصَّل (ج.م)</label>
                        <input type="text" class="form-control" id="settleAmount" name="amount" dir="ltr" inputmode="decimal" required>
                        <div class="form-text">يمكن تحصيل جزء من المبلغ. المتبقي: <span id="settleOutstanding"></span> ج.م</div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">إلغاء</button>
                        <button type="submit" class="btn btn-warning">تسجيل التحصيل</button>
                    </div>
                </form>
            </div>
        </div>
    @endif
@endsection

@push('scripts')
<script>
(() => {
    'use strict';

    const WALLETS = @json($walletData);
    if (!WALLETS.length) return;

    const $ = (id) => document.getElementById(id);
    const form = $('txnForm');
    const walletInput = $('walletId'), typeInput = $('txnType'), keyInput = $('idemKey');
    const counterpartyEl = $('counterparty'), amountEl = $('amount'), commissionEl = $('commission'), feeEl = $('fee');
    const customerEl = $('customer_name'), paymentBox = $('paymentBox'), submitBtn = $('submitBtn'), preview = $('preview');
    const CAN_OPERATE = @json($canOperate);

    // ---------- helpers ----------
    // Arabic-Indic digits -> ASCII. A comma is deliberately NOT converted (1,500 is rejected, never guessed).
    const ascii = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').replace(/٬/g, '');
    const toCents = (s) => {
        const v = ascii(s).trim();
        if (v === '' || v === '.' || !/^\d*\.?\d{0,2}$/.test(v)) return null;
        return Math.round(parseFloat(v) * 100);
    };
    const fmt = (c) => (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const plain = (c) => (c / 100).toFixed(2);

    // Same cleaning as the server: ASCII digits, no spaces, dashes, brackets or invisible marks.
    const cleanNumber = (value) => {
        const v = ascii(value).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00A0]/g, '').trim();
        return v.includes('@') ? v.toLowerCase() : v.replace(/[\s\-().]+/g, '');
    };
    const validCounterparty = (v) => /^\+?\d{6,15}$/.test(v) || /^[a-z0-9._-]{3,64}@[a-z]{2,20}$/.test(v);

    // crypto.randomUUID only exists on secure origins; a LAN address is plain http.
    function uuid() {
        if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
        const bytes = new Uint8Array(16);
        if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
        else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    const el = (tag, attrs = {}, ...kids) => {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
        }
        kids.flat().forEach((kid) => { if (kid != null) node.append(kid); });
        return node;
    };

    // ---------- state ----------
    const state = {
        wallet: WALLETS.find((w) => w.id === Number(walletInput.value)) || WALLETS[0],
        type: typeInput.value === 'receive' ? 'receive' : 'send',
    };
    walletInput.value = state.wallet.id;
    if (!keyInput.value) keyInput.value = uuid();

    const method = () => (document.querySelector('input[name="payment_method"]:checked')?.value || 'cash');

    function suggestCommission(amount) {
        const c = state.wallet.commission;
        if (!c.percent && !c.min) return null;
        return Math.max(c.min, Math.round(amount * c.percent / 100));
    }

    function suggestFee(amount) {
        const f = state.wallet.fee;
        if (!f.percent && !f.min) return null;
        let value = Math.max(f.min, Math.round(amount * f.percent / 100));
        if (f.max !== null) value = Math.min(value, f.max);
        return value;
    }

    function autofill() {
        const amount = toCents(amountEl.value) ?? 0;
        const hint = $('commissionHint');

        if (commissionEl.dataset.touched !== '1') {
            const suggested = amount > 0 ? suggestCommission(amount) : null;
            commissionEl.value = suggested === null ? '' : plain(suggested);
        }
        if (feeEl.dataset.touched !== '1') {
            const suggested = amount > 0 ? suggestFee(amount) : null;
            feeEl.value = suggested === null ? '' : plain(suggested);
        }

        const c = state.wallet.commission;
        hint.textContent = (c.percent || c.min)
            ? `مقترح: ${c.percent}% بحد أدنى ${fmt(c.min)} ج.م (يمكن تعديله)`
            : '';
    }

    // ---------- preview ----------
    const LIMITS = [
        ['sent_day', 'تحويل يومي', 'send'],
        ['sent_month', 'تحويل شهري', 'send'],
        ['received_day', 'استلام يومي', 'receive'],
        ['received_month', 'استلام شهري', 'receive'],
    ];

    function summaryRow(label, value, cls = '') {
        return el('div', { class: 'd-flex justify-content-between py-1 ' + cls },
            el('span', { text: label }), el('span', { class: 'fw-semibold', text: value }));
    }

    function render() {
        const w = state.wallet, t = state.type;
        const amount = toCents(amountEl.value) ?? 0;
        const commission = toCents(commissionEl.value) ?? 0;
        const fee = toCents(feeEl.value) ?? 0;
        const deferred = t === 'send' && method() === 'deferred';
        const delta = t === 'send' ? -(amount + fee) : (amount - fee);
        const after = w.balance + delta;
        const problems = [];

        const counterparty = counterpartyEl.value.trim();
        if (counterparty !== '' && !validCounterparty(counterparty)) {
            problems.push('رقم الهاتف غير صالح. اكتب أرقاماً فقط (من 6 إلى 15 رقماً، ويمكن أن يبدأ بـ +) أو عنوان إنستا باي.');
        }

        if (/[,]/.test(amountEl.value + commissionEl.value + feeEl.value)) problems.push('اكتب الأرقام بدون فواصل (مثال: 1500).');
        if (amountEl.value.trim() !== '' && toCents(amountEl.value) === null) problems.push('المبلغ غير صالح.');
        if (amount > 0) {
            if (w.perTransaction !== null && amount > w.perTransaction) problems.push('المبلغ أكبر من حد العملية الواحدة (' + fmt(w.perTransaction) + ').');
            LIMITS.filter((l) => l[2] === t).forEach(([key, label]) => {
                const limit = w.limits[key];
                if (limit !== null && w.usage[key] + amount > limit) {
                    problems.push('سيتجاوز الحد ال' + label.split(' ')[1] + '. المتبقي ' + fmt(Math.max(0, limit - w.usage[key])) + '.');
                }
            });
            if (after < 0) problems.push('رصيد المحفظة لا يكفي (المتاح ' + fmt(w.balance) + ').');
            if (commission > amount) problems.push('العمولة أكبر من المبلغ.');
        }

        const nodes = [];

        nodes.push(el('div', { class: 'mb-2' },
            el('div', { class: 'fw-semibold', text: w.name }),
            el('small', { class: 'text-body-secondary', text: '#' + w.id + [w.provider, w.identifier].filter(Boolean).map((p) => ' · ' + p).join('') })));

        if (amount > 0) {
            if (t === 'send') {
                nodes.push(summaryRow(deferred ? 'مستحق على العميل (آجل)' : 'العميل يدفع لك كاش', fmt(amount + commission) + ' ج.م', 'fs-5 text-primary'));
            } else {
                nodes.push(summaryRow('تدفع للعميل كاش', fmt(Math.max(0, amount - commission)) + ' ج.م', 'fs-5 text-success'));
            }
            nodes.push(summaryRow('صافي ربحك من العملية', fmt(commission - fee) + ' ج.م', commission - fee < 0 ? 'text-danger' : ''));
        }
        nodes.push(summaryRow('رصيد المحفظة الآن', fmt(w.balance) + ' ج.م'));
        if (amount > 0) {
            nodes.push(summaryRow('رصيد المحفظة بعد العملية', fmt(after) + ' ج.م', after < 0 ? 'text-danger' : ''));
        }

        nodes.push(el('hr', { class: 'my-2' }));

        if (w.perTransaction !== null) {
            nodes.push(el('div', { class: 'small text-body-secondary mb-2', text: 'حد العملية الواحدة: ' + fmt(w.perTransaction) + ' ج.م' }));
        }

        LIMITS.forEach(([key, label, kind]) => {
            const limit = w.limits[key];
            const used = w.usage[key];
            const projected = kind === t ? used + amount : used;

            if (limit === null) {
                nodes.push(el('div', { class: 'small mb-2 d-flex justify-content-between' },
                    el('span', { text: label }), el('span', { class: 'text-body-secondary', text: 'بدون حد' })));
                return;
            }

            const pct = Math.min(100, Math.floor(projected * 100 / limit));
            const level = projected > limit ? 'bg-danger' : (pct >= w.warn ? 'bg-warning' : 'bg-success');

            nodes.push(el('div', { class: 'mb-2' },
                el('div', { class: 'd-flex justify-content-between small' },
                    el('span', { text: label }),
                    el('span', { text: fmt(projected) + ' / ' + fmt(limit) + ' (المتبقي ' + fmt(Math.max(0, limit - projected)) + ')' })),
                el('div', { class: 'progress', style: 'height:.5rem', role: 'progressbar', 'aria-label': label, 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100 },
                    el('div', { class: 'progress-bar ' + level, style: 'width:' + pct + '%' }))));
        });

        problems.forEach((text) => nodes.push(el('div', { class: 'alert alert-danger py-2 mt-2 mb-0 small', role: 'alert', text })));

        preview.replaceChildren(...nodes);

        const ready = CAN_OPERATE && amount > 0 && counterpartyEl.value.trim() !== '' && problems.length === 0;
        submitBtn.disabled = !ready;
    }

    function syncUi() {
        document.querySelectorAll('[data-wallet-id]').forEach((b) => {
            const on = Number(b.dataset.walletId) === state.wallet.id;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        document.querySelectorAll('[data-type]').forEach((b) => {
            const on = b.dataset.type === state.type;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        $('counterpartyLabel').textContent = state.type === 'send' ? 'رقم المستلم' : 'رقم المرسل (العميل)';
        paymentBox.classList.toggle('d-none', state.type !== 'send');
        if (state.type !== 'send') document.getElementById('payCash').checked = true;
        customerEl.required = state.type === 'send' && method() === 'deferred';

        walletInput.value = state.wallet.id;
        typeInput.value = state.type;
        autofill();
        render();
    }

    // ---------- events ----------
    document.querySelectorAll('[data-wallet-id]').forEach((b) => b.addEventListener('click', () => {
        state.wallet = WALLETS.find((w) => w.id === Number(b.dataset.walletId)) || state.wallet;
        commissionEl.dataset.touched = ''; feeEl.dataset.touched = '';
        syncUi();
    }));
    document.querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
        state.type = b.dataset.type;
        syncUi();
    }));
    document.querySelectorAll('input[name="payment_method"]').forEach((r) => r.addEventListener('change', syncUi));

    [amountEl, commissionEl, feeEl].forEach((input) => input.addEventListener('input', () => {
        input.value = ascii(input.value);
        if (input !== amountEl) input.dataset.touched = '1';
        if (input === amountEl) autofill();
        render();
    }));
    counterpartyEl.addEventListener('input', () => {
        const cleaned = cleanNumber(counterpartyEl.value);
        if (cleaned !== counterpartyEl.value) counterpartyEl.value = cleaned;
        render();
    });

    form.addEventListener('submit', (event) => {
        if (submitBtn.disabled) { event.preventDefault(); return; }
        submitBtn.disabled = true;               // the idempotency key also blocks a second submit server-side
        submitBtn.querySelector('span').textContent = 'جاري الحفظ…';
    });

    // ---------- modals ----------
    document.getElementById('reverseModal')?.addEventListener('show.bs.modal', (event) => {
        const b = event.relatedTarget;
        $('reverseForm').action = b.dataset.action;
        $('reverseSummary').textContent = b.dataset.summary;
        $('reverseReason').value = '';
    });
    document.getElementById('settleModal')?.addEventListener('show.bs.modal', (event) => {
        const b = event.relatedTarget;
        $('settleForm').action = b.dataset.action;
        $('settleCustomer').textContent = b.dataset.customer || '-';
        $('settleOutstanding').textContent = b.dataset.outstanding;
        $('settleAmount').value = b.dataset.outstanding;
    });

    syncUi();
})();
</script>
@endpush
