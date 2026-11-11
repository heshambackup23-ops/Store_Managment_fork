@extends('layouts.app')
@section('title', 'Database backup')
@section('content')
<div class="container-fluid py-4">
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-4">
        <div><h1 class="h3 mb-1">Database backup</h1><p class="text-muted mb-0">Export selected data pages to formatted Excel workbooks in one ZIP file.</p></div>
    </div>
    <div class="row g-4">
        <div class="col-xl-8">
            <div class="card border-0 shadow-sm rounded-4"><div class="card-body p-4">
                <div class="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-3"><h2 class="h5 mb-0">Choose pages</h2><div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" type="button" id="selectAll">Select all</button><button class="btn btn-outline-secondary" type="button" id="selectNone">Clear</button></div></div>
                <div class="row g-2" id="backupPages">
                    @foreach(['catalog' => 'Products and categories', 'customers' => 'Customers', 'sales' => 'Sales', 'invoices' => 'Invoices', 'installments' => 'Installments and debts', 'suppliers' => 'Suppliers and purchases', 'maintenance' => 'Maintenance', 'wallets' => 'Wallets', 'damaged' => 'Damaged items', 'notifications' => 'Notifications', 'team' => 'Users and permissions'] as $key => $label)
                        <div class="col-md-6"><label class="form-check border rounded-3 p-3 ps-5 h-100"><input class="form-check-input backup-page" type="checkbox" value="{{ $key }}" checked><span class="form-check-label">{{ $label }}</span></label></div>
                    @endforeach
                </div>
                <div class="d-flex flex-wrap gap-2 mt-4"><button class="btn btn-primary" type="button" id="downloadBackup"><i class="fa-solid fa-download me-2"></i>Download ZIP backup</button><span class="small text-muted align-self-center" id="backupStatus" aria-live="polite"></span></div>
            </div></div>
        </div>
        @if($canManage)
        <div class="col-xl-4"><div class="card border-0 shadow-sm rounded-4"><div class="card-body p-4">
            <h2 class="h5">Import backup</h2><p class="text-muted small">Choose a ZIP created by this system, then select which included pages to import. Existing records with matching IDs are updated.</p>
            <label class="form-label" for="backupFile">Backup ZIP file</label><input id="backupFile" class="form-control" type="file" accept=".zip,application/zip,application/x-zip-compressed">
            <button class="btn btn-outline-primary w-100 mt-3" type="button" id="importBackup"><i class="fa-solid fa-upload me-2"></i>Import selected pages</button>
            <div class="small mt-3" id="importStatus" aria-live="polite"></div>
        </div></div></div>
        @endif
    </div>
</div>
@endsection
@push('scripts')
<script>
(() => {
    const boxes = () => [...document.querySelectorAll('.backup-page')];
    const selected = () => boxes().filter(x => x.checked).map(x => x.value);
    document.getElementById('selectAll')?.addEventListener('click', () => boxes().forEach(x => x.checked = true));
    document.getElementById('selectNone')?.addEventListener('click', () => boxes().forEach(x => x.checked = false));
    document.getElementById('downloadBackup')?.addEventListener('click', async () => {
        const pages = selected(), status = document.getElementById('backupStatus'), button = document.getElementById('downloadBackup');
        if (!pages.length) { status.textContent = 'Select at least one page.'; return; }
        button.disabled = true; status.textContent = 'Preparing backup…';
        try {
            const query = new URLSearchParams(); pages.forEach(page => query.append('pages[]', page));
            const response = await fetch(`{{ route('backup.export') }}?${query}`, {headers: {Accept: 'application/zip, application/json'}});
            if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.message || `Download failed (${response.status})`); }
            const blob = await response.blob(), url = URL.createObjectURL(blob), anchor = document.createElement('a');
            anchor.href = url; anchor.download = (response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/) || [])[1] || 'store-backup.zip';
            document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); status.textContent = 'Backup downloaded.';
        } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
    });
    document.getElementById('importBackup')?.addEventListener('click', async () => {
        const file = document.getElementById('backupFile').files[0], pages = selected(), status = document.getElementById('importStatus'), button = document.getElementById('importBackup');
        if (!file || !pages.length) { status.textContent = 'Choose a ZIP file and at least one page.'; return; }
        const body = new FormData(); body.append('file', file); pages.forEach(page => body.append('pages[]', page));
        button.disabled = true; status.textContent = 'Importing…';
        try {
            const response = await fetch('{{ route('backup.import') }}', {method: 'POST', body, headers: {Accept: 'application/json', 'X-CSRF-TOKEN': '{{ csrf_token() }}'}});
            const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Import failed.');
            status.textContent = result.data?.message || 'Import complete.';
        } catch (error) { status.textContent = error.message; } finally { button.disabled = false; }
    });
})();
</script>
@endpush
