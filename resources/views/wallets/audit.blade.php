@extends('layouts.app')

@section('main')
    @include('wallets._nav')

    <h3 class="mb-3">سجل معاملات المحافظ</h3>

    @if ($errors->any())
        <div class="alert alert-danger"><ul class="mb-0">@foreach ($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul></div>
    @endif

    <form method="GET" action="{{ route('wallets.audit.index') }}" class="card shadow-sm mb-3">
        <div class="card-body row g-2 align-items-end">
            <div class="col-md-4">
                <label for="q" class="form-label small mb-1">بحث</label>
                <input type="search" id="q" name="q" class="form-control" maxlength="80" value="{{ $filters['q'] ?? '' }}"
                       placeholder="اسم المستخدم، نوع الحدث، السبب، رقم العنصر…">
            </div>
            <div class="col-md-3">
                <label for="action" class="form-label small mb-1">تصفية حسب نوع السجل</label>
                <select id="action" name="action" class="form-select">
                    <option value="">كل الأحداث</option>
                    @foreach ($actions as $code => $label)
                        <option value="{{ $code }}" @selected(($filters['action'] ?? '') === $code)>{{ $label }}</option>
                    @endforeach
                </select>
            </div>
            <div class="col-md-2">
                <label for="from" class="form-label small mb-1">من تاريخ</label>
                <input type="date" id="from" name="from" class="form-control" value="{{ $filters['from'] ?? '' }}">
            </div>
            <div class="col-md-2">
                <label for="to" class="form-label small mb-1">إلى تاريخ</label>
                <input type="date" id="to" name="to" class="form-control" value="{{ $filters['to'] ?? '' }}">
            </div>
            <div class="col-md-1"><button class="btn btn-primary w-100" aria-label="بحث"><i class="fa-solid fa-magnifying-glass"></i></button></div>
        </div>
    </form>

    <div class="card shadow-sm">
        <div class="table-responsive">
            <table class="table table-sm align-middle mb-0">
                <thead><tr><th>الوقت</th><th>المستخدم</th><th>الحدث</th><th>العنصر</th><th>التفاصيل</th><th>العنوان (IP)</th></tr></thead>
                <tbody>
                    @forelse ($logs as $row)
                        <tr>
                            <td class="text-nowrap" dir="ltr">{{ $row['time'] }}</td>
                            <td>{{ $row['user'] }}</td>
                            <td><span class="badge {{ $row['badge'] }}">{{ $row['action'] }}</span></td>
                            <td class="text-nowrap">{{ $row['subject'] }}</td>
                            <td>
                                @forelse ($row['details'] as [$label, $value])
                                    <div class="small"><span class="text-body-secondary">{{ $label }}:</span> {{ $value }}</div>
                                @empty
                                    <span class="text-body-secondary">-</span>
                                @endforelse
                            </td>
                            <td class="small" dir="ltr">{{ $row['ip'] }}</td>
                        </tr>
                    @empty
                        <tr><td colspan="6" class="text-center text-body-secondary py-4">لا توجد سجلات مطابقة.</td></tr>
                    @endforelse
                </tbody>
            </table>
        </div>
        @if ($logs->hasPages())<div class="card-footer">{{ $logs->links() }}</div>@endif
    </div>
@endsection
