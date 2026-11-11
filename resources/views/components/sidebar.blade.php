@php
    $sidebarLinks = [
        ['route' => 'home',               'active' => 'home',            'can' => 'page.dashboard.view',    'icon' => 'fa-house',             'label' => 'الرئيسية'],
        ['route' => 'cashier.index',        'active' => 'cashier.*',        'can' => 'create-invoice',           'icon' => 'fa-cash-register',        'label' => 'الكاشير'],
        ['route' => 'wallets.index',        'active' => 'wallets.*',        'can' => 'page.wallets.view',        'icon' => 'fa-wallet',                'label' => 'المحافظ'],
        ['route' => 'wallet_cashier.index', 'active' => 'wallet_cashier.*', 'can' => 'page.wallet_cashier.view', 'icon' => 'fa-money-bill-transfer',   'label' => 'كاشير المحافظ'],
        ['route' => 'damaged.index',        'active' => 'damaged.*',        'can' => 'page.damaged.view',        'icon' => 'fa-triangle-exclamation', 'label' => 'هالِك'],
        ['route' => 'categories.index',   'active' => 'categories.*',    'can' => 'page.categories.view',   'icon' => 'fa-list',              'label' => 'التصنيفات'],
        ['route' => 'products.index',     'active' => 'products.*',      'can' => 'page.products.view',     'icon' => 'fa-cart-arrow-down',   'label' => 'المنتجات'],
        ['route' => 'maintenance.index',  'active' => 'maintenance.*',   'can' => 'page.maintenance.view',  'icon' => 'fa-wrench',            'label' => 'الصيانة'],
        ['route' => 'sales.index',        'active' => 'sales.*',         'can' => 'page.sales.view',        'icon' => 'fa-money-bill-wave',   'label' => 'المبيعات'],
        ['route' => 'invoices.index',     'active' => 'invoices.*',      'can' => 'page.invoices.view',     'icon' => 'fa-file-invoice',      'label' => 'الفواتير'],
        ['route' => 'customers.index',    'active' => 'customers.*',     'can' => 'page.customers.view',    'icon' => 'fa-users',             'label' => 'العملاء'],
        ['route' => 'suppliers.index',    'active' => 'suppliers.*',     'can' => 'page.suppliers.view',    'icon' => 'fa-truck-field',       'label' => 'الموردون والحسابات الدائنة'],
        ['route' => 'installments.index', 'active' => 'installments.*',  'can' => 'page.installments.view', 'icon' => 'fa-credit-card',       'label' => 'الديون'],
        ['route' => 'users.index',        'active' => 'users.*',         'can' => 'page.staff.view',        'icon' => 'fa-user-group',        'label' => 'الموظفون'],
    ];
@endphp

<aside id="appSidebar" class="sidebar offcanvas-lg offcanvas-start bg-body-tertiary border-start p-3 flex-shrink-0" tabindex="-1" aria-labelledby="appSidebarLabel">
    <div class="offcanvas-header d-lg-none px-0 pt-0">
        <h2 class="offcanvas-title fs-5" id="appSidebarLabel">القائمة</h2>
        <button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>
    </div>
    <nav class="nav flex-column gap-1" aria-label="القائمة الرئيسية">

        @foreach ($sidebarLinks as $link)
            {{-- Skip a link instead of crashing the whole page if a route name is missing. --}}
            @if (\Illuminate\Support\Facades\Route::has($link['route']))
                @can($link['can'])
                    @php $isActive = request()->routeIs($link['active']); @endphp
                    <a href="{{ route($link['route']) }}"
                       class="nav-link rounded d-flex align-items-center gap-2 {{ $isActive ? 'active' : 'text-body' }}"
                       @if ($isActive) aria-current="page" @endif>
                        <i class="fa-solid {{ $link['icon'] }}" aria-hidden="true"></i>
                        <span>{{ $link['label'] }}</span>
                    </a>
                @endcan
            @endif
        @endforeach

        {{-- Superadmin only. This is not part of the role permission matrix. --}}
        @if (auth()->check() && auth()->user()->isSuperAdmin() && \Illuminate\Support\Facades\Route::has('roles.index'))
            @php $rolesActive = request()->routeIs('roles.*'); @endphp
            <a href="{{ route('roles.index') }}"
               class="nav-link rounded d-flex align-items-center gap-2 {{ $rolesActive ? 'active' : 'text-body' }}"
               @if ($rolesActive) aria-current="page" @endif>
                <i class="fa-solid fa-user-shield" aria-hidden="true"></i>
                <span>تعيين الأدوار</span>
            </a>
        @endif

    </nav>
</aside>
