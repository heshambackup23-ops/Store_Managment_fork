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
                    <div class="card border-0 shadow-sm rounded-4"><div class="card-body">
                        <h5 class="card-title mb-3"><i class="fas fa-database me-2" style="color:#667eea"></i>Database backup</h5>
                        <p class="text-muted mb-3">Download or import formatted Excel backups from the dedicated backup page.</p>
                        <a href="{{ route('backup.index') }}" class="btn btn-primary w-100">Open backup page</a>
                    </div></div>
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

