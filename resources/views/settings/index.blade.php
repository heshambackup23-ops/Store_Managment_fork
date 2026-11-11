@extends('layouts.app')
@section('title', '- الإعدادات')
@section('content')

<div class="container py-5">
    <div class="card rounded-4 shadow-sm border-0">
        <div class="card-header bg-gradient py-4" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
            <h4 class="text-white mb-0">
                <i class="fas fa-cogs me-2"></i> إعدادات التطبيق
            </h4>
        </div>
        <div class="card-body p-4">
            <div class="alert alert-info rounded-4">
                <i class="fas fa-info-circle me-2"></i>
                تحتوي هذه الصفحة على إعدادات عامة للتطبيق. يمكن توسيعها لاحقاً لإدارة المزيد من الخيارات.
            </div>

            <div class="row g-4 mt-3">
                <div class="col-md-6">
                    <div class="card border-0 shadow-sm rounded-4">
                        <div class="card-body">
                            <h5 class="card-title mb-3">
                                <i class="fas fa-database me-2" style="color: #667eea;"></i> النسخ الاحتياطية
                            </h5>
                            <p class="text-muted mb-3">قم بتنزيل نسخة احتياطية من جميع بيانات التطبيق</p>
                            <button id="backupBtn" type="button" class="btn btn-primary w-100" data-format="{{ Auth::user()->can('page.backup.manage') ? 'jsonl' : 'zip' }}">
                                <i class="fas fa-download me-2"></i> تحميل نسخة احتياطية
                            </button>
                            @can('page.backup.manage')
                            <div class="mt-3" id="backupPages">
                                <strong class="d-block mb-2">Backup pages</strong>
                                <div class="row g-2">
                                    @foreach(['catalog' => 'Products and categories', 'customers' => 'Customers', 'sales' => 'Sales', 'invoices' => 'Invoices', 'installments' => 'Installments and debts', 'suppliers' => 'Suppliers', 'maintenance' => 'Maintenance', 'wallets' => 'Wallets', 'damaged' => 'Damaged items', 'notifications' => 'Notifications', 'team' => 'Users and permissions'] as $key => $label)
                                        <div class="col-6"><label class="form-check"><input class="form-check-input backup-page" type="checkbox" value="{{ $key }}" checked><span class="form-check-label">{{ $label }}</span></label></div>
                                    @endforeach
                                </div>
                            </div>
                                <hr>
                                <label for="backupFile" class="form-label">Import backup file</label>
                                <input id="backupFile" class="form-control mb-2" type="file" accept=".jsonl,.json,application/json,application/x-ndjson,text/plain">
                                <button id="restoreBtn" type="button" class="btn btn-outline-primary w-100">Import selected pages</button>
                            @endcan
                        </div>
                    </div>
                </div>

                <div class="col-md-6">
                    <div class="card border-0 shadow-sm rounded-4">
                        <div class="card-body">
                            <h5 class="card-title mb-3">
                                <i class="fas fa-file-import me-2" style="color: #764ba2;"></i> الملف الشخصي
                            </h5>
                            <p class="text-muted mb-3">قم بتحديث بياناتك الشخصية والصورة الشخصية</p>
                            <a href="{{ route('profile.edit', Auth::user()->id) }}" class="btn btn-outline-primary w-100">
                                <i class="fas fa-edit me-2"></i> تحديث الملف الشخصي
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

@endsection

@push('scripts')
<script>
    (function () {
        const btn = document.getElementById('backupBtn');
        if (!btn) return;
        const selectedPages = () => Array.from(document.querySelectorAll('.backup-page:checked')).map(input => input.value);
        btn.addEventListener('click', async function () {
            const format = btn.getAttribute('data-format') || 'zip';
            const params = new URLSearchParams({ format });
            if (format === 'jsonl') selectedPages().forEach(page => params.append('pages[]', page));
            if (format === 'jsonl' && selectedPages().length === 0) { window.showBootstrapAlert('Select at least one page', 'warning'); return; }
            const url = `{{ route('backup.export') }}?${params.toString()}`;
            try {
                const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
                if (!res.ok) {
                    const ct = res.headers.get('content-type') || '';
                    if (ct.includes('application/json')) {
                        const j = await res.json();
                        window.showBootstrapAlert(j.error || j.message || 'حدث خطأ', 'danger');
                    } else {
                        window.showBootstrapAlert('Server error: ' + res.status, 'danger');
                    }
                    return;
                }

                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const j = await res.json();
                    window.showBootstrapAlert(j.error || j.message || 'حدث خطأ', 'danger');
                    return;
                }

                const blob = await res.blob();
                const cd = res.headers.get('content-disposition') || '';
                let filename = 'backup';
                const m = cd.match(/filename\*=UTF-8''(.+)|filename=\"?([^\";]+)\"?/);
                if (m) {
                    filename = decodeURIComponent(m[1] || m[2]);
                }
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(a.href);
            } catch (err) {
                window.showBootstrapAlert('خطأ أثناء تنزيل النسخة الاحتياطية: ' + err.message, 'danger');
            }
        });
        document.getElementById('restoreBtn')?.addEventListener('click', async function () {
            const file = document.getElementById('backupFile').files[0];
            const pages = selectedPages();
            if (!file || pages.length === 0) { window.showBootstrapAlert('Choose a backup file and at least one page', 'warning'); return; }
            const body = new FormData();
            body.append('file', file);
            pages.forEach(page => body.append('pages[]', page));
            try {
                const response = await fetch('{{ route('backup.import') }}', { method: 'POST', body, headers: { 'Accept': 'application/json', 'X-CSRF-TOKEN': '{{ csrf_token() }}' } });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message || 'Import failed');
                window.showBootstrapAlert(result.data?.message || 'Import completed', 'success');
            } catch (error) { window.showBootstrapAlert(error.message || 'Import failed', 'danger'); }
        });
    })();
</script>
@endpush
