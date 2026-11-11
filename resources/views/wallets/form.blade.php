@extends('layouts.app')

@section('main')
    @include('wallets._nav')
    @php
        $editing = $wallet->exists;
        $value = fn (string $field, $default = '') => old($field, $wallet->{$field} ?? $default);
        // Show 0 / empty limits as empty inputs.
        $limit = fn (string $field) => old($field, ((float) ($wallet->{$field} ?? 0)) > 0 ? $wallet->{$field} : '');
    @endphp

    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <h3 class="mb-0">{{ $editing ? 'تعديل المحفظة' : 'إضافة محفظة' }}</h3>
        <a href="{{ route('wallets.index') }}" class="btn btn-outline-secondary">رجوع</a>
    </div>

    @if ($errors->any())
        <div class="alert alert-danger">
            <ul class="mb-0">@foreach ($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul>
        </div>
    @endif

    <form method="POST" action="{{ $editing ? route('wallets.update', $wallet) : route('wallets.store') }}" novalidate>
        @csrf
        @if ($editing) @method('PUT') @endif

        <div class="card shadow-sm mb-3">
            <div class="card-header fw-semibold">بيانات المحفظة</div>
            <div class="card-body row g-3">
                <div class="col-md-6">
                    <label for="name" class="form-label">اسم المحفظة</label>
                    <input type="text" id="name" name="name" class="form-control @error('name') is-invalid @enderror"
                           value="{{ $value('name') }}" maxlength="100" placeholder="اختياري. مثال: فودافون كاش - الخط الأول">
                    @error('name')<div class="invalid-feedback">{{ $message }}</div>@enderror
                </div>
                <div class="col-md-6">
                    <label for="provider" class="form-label">نوع المحفظة</label>
                    <select id="provider" name="provider" class="form-select @error('provider') is-invalid @enderror">
                        <option value="">— غير محدد —</option>
                        @foreach (\App\Models\Wallet::PROVIDERS as $key => $label)
                            <option value="{{ $key }}" @selected($value('provider', '') === $key)>{{ $label }}</option>
                        @endforeach
                    </select>
                    @error('provider')<div class="invalid-feedback">{{ $message }}</div>@enderror
                </div>
                <div class="col-md-6">
                    <label for="identifier" class="form-label">رقم المحفظة / عنوان إنستا باي</label>
                    <input type="text" id="identifier" name="identifier" dir="ltr" class="form-control @error('identifier') is-invalid @enderror"
                           value="{{ $value('identifier') }}" maxlength="64" placeholder="اختياري: 01012345678">
                    <div class="form-text">يمكن استخدام نفس الرقم أو الاسم لأكثر من محفظة.</div>
                    @error('identifier')<div class="invalid-feedback">{{ $message }}</div>@enderror
                </div>
                <div class="col-md-6">
                    <label for="holder_name" class="form-label">اسم صاحب المحفظة (اختياري)</label>
                    <input type="text" id="holder_name" name="holder_name" class="form-control @error('holder_name') is-invalid @enderror"
                           value="{{ $value('holder_name') }}" maxlength="100">
                    @error('holder_name')<div class="invalid-feedback">{{ $message }}</div>@enderror
                </div>
                @unless ($editing)
                    <div class="col-md-6">
                        <label for="opening_balance" class="form-label">الرصيد الحالي للمحفظة (افتتاحي)</label>
                        <input type="text" inputmode="decimal" id="opening_balance" name="opening_balance" dir="ltr"
                               class="form-control @error('opening_balance') is-invalid @enderror" value="{{ old('opening_balance', '0') }}">
                        <div class="form-text">يُحدَّد مرة واحدة. بعدها يتغير الرصيد بالعمليات أو بالتسوية فقط.</div>
                        @error('opening_balance')<div class="invalid-feedback">{{ $message }}</div>@enderror
                    </div>
                @endunless
                <div class="col-md-6 d-flex align-items-end">
                    <div class="form-check form-switch">
                        <input type="hidden" name="is_active" value="0">
                        <input class="form-check-input" type="checkbox" role="switch" id="is_active" name="is_active" value="1"
                               @checked(old('is_active', $wallet->is_active ?? true))>
                        <label class="form-check-label" for="is_active">المحفظة نشطة</label>
                    </div>
                </div>
            </div>
        </div>

        <div class="card shadow-sm mb-3">
            <div class="card-header fw-semibold">الحدود (اتركها فارغة لو لا يوجد حد)</div>
            <div class="card-body row g-3">
                <div class="col-12 small text-body-secondary">
                    حدود شركات الاتصال تختلف حسب نوع المحفظة وتتغير من وقت لآخر، لذلك اكتبها بنفسك حسب محفظتك.
                    النظام يمنع أي عملية تتجاوز الحد، وينبّه قبل الوصول إليه.
                </div>
                @foreach ([
                    'per_transaction_limit' => 'حد العملية الواحدة',
                    'daily_send_limit' => 'حد التحويل اليومي',
                    'monthly_send_limit' => 'حد التحويل الشهري',
                    'daily_receive_limit' => 'حد الاستلام اليومي',
                    'monthly_receive_limit' => 'حد الاستلام الشهري',
                ] as $field => $label)
                    <div class="col-md-4">
                        <label for="{{ $field }}" class="form-label">{{ $label }}</label>
                        <input type="text" inputmode="decimal" dir="ltr" id="{{ $field }}" name="{{ $field }}"
                               class="form-control @error($field) is-invalid @enderror" value="{{ $limit($field) }}">
                        @error($field)<div class="invalid-feedback">{{ $message }}</div>@enderror
                    </div>
                @endforeach
                <div class="col-md-4">
                    <label for="warn_at_percent" class="form-label">نبّهني عند استهلاك (%)</label>
                    <input type="number" min="1" max="100" id="warn_at_percent" name="warn_at_percent"
                           class="form-control @error('warn_at_percent') is-invalid @enderror" value="{{ $value('warn_at_percent', 80) }}">
                    @error('warn_at_percent')<div class="invalid-feedback">{{ $message }}</div>@enderror
                </div>
            </div>
        </div>

        <div class="card shadow-sm mb-3">
            <div class="card-header fw-semibold">قيم مقترحة في الكاشير (يمكن تعديلها في كل عملية)</div>
            <div class="card-body row g-3">
                @foreach ([
                    'default_commission_percent' => 'نسبة عمولتك %',
                    'default_commission_min' => 'أقل عمولة (ج.م)',
                    'default_fee_percent' => 'نسبة رسوم المزود %',
                    'default_fee_min' => 'أقل رسوم (ج.م)',
                    'default_fee_max' => 'أقصى رسوم (ج.م)',
                ] as $field => $label)
                    <div class="col-md-4">
                        <label for="{{ $field }}" class="form-label">{{ $label }}</label>
                        <input type="text" inputmode="decimal" dir="ltr" id="{{ $field }}" name="{{ $field }}"
                               class="form-control @error($field) is-invalid @enderror" value="{{ $limit($field) }}">
                        @error($field)<div class="invalid-feedback">{{ $message }}</div>@enderror
                    </div>
                @endforeach
                <div class="col-12">
                    <label for="notes" class="form-label">ملاحظات</label>
                    <textarea id="notes" name="notes" rows="2" maxlength="500" class="form-control @error('notes') is-invalid @enderror">{{ $value('notes') }}</textarea>
                    @error('notes')<div class="invalid-feedback">{{ $message }}</div>@enderror
                </div>
            </div>
        </div>

        <button type="submit" class="btn btn-primary btn-lg">
            <i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> حفظ
        </button>
    </form>
@endsection
