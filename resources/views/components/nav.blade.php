<nav class="navbar navbar-expand-lg bg-body-tertiary border-bottom shadow-sm">
  <div class="container-fluid d-flex align-items-center gap-2">
    <button class="btn btn-outline-secondary d-lg-none flex-shrink-0" type="button" data-bs-toggle="offcanvas" data-bs-target="#appSidebar" aria-controls="appSidebar" aria-label="فتح القائمة">
      <i class="fa-solid fa-bars" aria-hidden="true"></i>
    </button>

    <a class="navbar-brand d-flex align-items-center gap-2 me-auto ms-0 text-truncate" href="{{ route('home') }}">
      <i class="fa-solid fa-mobile"></i>
      <span>{{ config('app.name', 'PhoneStore') }}</span>
    </a>

    <div class="collapse navbar-collapse flex-grow-0" id="navbarNav">
      <div id="navbarActions" class="navbar-nav align-items-center gap-3">
        @guest
          <div class="d-flex gap-2">
            <a class="btn btn-outline-primary btn-sm" href="{{ route('showLogin') }}">تسجيل الدخول</a>
          </div>
        @endguest

        @auth
          <div id="notificationDropdown" class="dropdown me-3" dir="rtl">
            <a class="nav-link position-relative d-flex align-items-center gap-2 py-2" href="#" data-bs-toggle="dropdown" role="button" aria-expanded="false">
              <i class="fas fa-bell fa-lg"></i>
              @if(isset($appNotifications) && $appNotifications->count())
                @php $unreadCount = $unreadCount ?? $appNotifications->where('is_read', false)->count(); @endphp
                @if($unreadCount > 0)
                    <span class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger" data-notification-count>
                      <span data-count-value>{{ $unreadCount }}</span>
                      <span class="visually-hidden">إشعارات جديدة</span>
                  </span>
                @endif
              @endif
            </a>
            <ul class="dropdown-menu dropdown-menu-end">
              @if(isset($appNotifications) && $appNotifications->count())
                @foreach($appNotifications->take(5) as $notification)
                  <li>
                      <button class="dropdown-item text-start {{ $notification->is_read ? 'text-muted' : '' }}" type="button" data-notification-read data-notification-id="{{ $notification->id }}" data-read-url="{{ route('notifications.markRead', $notification->id) }}" aria-pressed="{{ $notification->is_read ? 'true' : 'false' }}">
                        <strong>{{ $notification->title }}</strong>
                        @if(!$notification->is_read)
                          <span class="badge bg-primary ms-2">جديد</span>
                        @endif
                        <br>
                        <span class="text-muted small">{{ \Illuminate\Support\Str::limit($notification->message, 50) }}</span>
                      </button>
                  </li>
                  @if(!$loop->last)
                    <li><hr class="dropdown-divider"></li>
                  @endif
                @endforeach
                <li><hr class="dropdown-divider"></li>
              @else
                <li><span class="dropdown-item text-muted">لا توجد إشعارات حالياً</span></li>
                <li><hr class="dropdown-divider"></li>
              @endif
              <li>
                <a class="dropdown-item" href="{{ route('notifications.list') }}">عرض كل الإشعارات</a>
              </li>
              <li>
                <form method="POST" action="{{ route('notifications.markAllRead') }}">
                  @csrf
                  <button class="dropdown-item" type="submit">وضع الكل كمُقروء</button>
                </form>
              </li>
              @can('page.notifications.manage')
                <li><hr class="dropdown-divider"></li>
                <li>
                  <a class="dropdown-item" href="{{ route('admin.notifications.index') }}">إدارة الإشعارات</a>
                </li>
              @endcan
            </ul>
          </div>

          <div class="dropdown m-1" dir="rtl">
            <a class="nav-link dropdown-toggle d-flex align-items-center gap-2 py-2" href="#" data-bs-toggle="dropdown" role="button" aria-expanded="false">
              <i class="fas fa-user-circle fa-lg"></i>
              <span class="d-none d-md-inline fw-medium">{{ Auth::user()->name }}</span>
            </a>
            <ul class="dropdown-menu dropdown-menu-end">
              <li>
                <a class="dropdown-item" href="{{ route('profile.index') }}">
                  <i class="fas fa-user me-2"></i> الملف الشخصي
                </a>
              </li>
              <li><hr class="dropdown-divider"></li>
              <li>
                <a class="dropdown-item text-danger" href="#" onclick="event.preventDefault(); document.getElementById('logout-form').submit();">
                  <i class="fas fa-sign-out-alt me-2"></i> تسجيل الخروج
                </a>
              </li>
            </ul>
          </div>
          <form id="logout-form" action="{{ route('logout') }}" method="POST" class="d-none">
            @csrf
          </form>
        @endauth
      </div>
    </div>


    <button id="theme-toggle" class="btn btn-outline-secondary btn-sm rounded-pill d-flex align-items-center gap-2 flex-shrink-0" type="button" aria-label="Toggle theme">
      <i class="fas fa-moon fa-lg" id="theme-icon"></i>
      <span class="d-none d-sm-inline theme-label">الوضع الداكن</span>
    </button>
  </div>
</nav>
@push('scripts')
<script>
(() => {
  const actions = document.getElementById('navbarActions');
  const sidebar = document.getElementById('appSidebar');
  const navbar = document.getElementById('navbarNav');
  const notification = document.getElementById('notificationDropdown');
  if (!actions || !sidebar || !navbar) return;

  const desktop = window.matchMedia('(min-width: 992px)');
  const placeActions = () => {
    if (desktop.matches) {
      if (notification) actions.prepend(notification);
      navbar.append(actions);
      actions.classList.remove('mobile-sidebar-actions');
    } else {
      sidebar.append(actions);
      actions.classList.add('mobile-sidebar-actions');
      if (notification) actions.prepend(notification);
    }
  };

  placeActions();
  desktop.addEventListener('change', placeActions);

  actions.querySelectorAll('.dropdown').forEach((dropdown) => {
    const menu = dropdown.querySelector('.dropdown-menu');
    const toggle = dropdown.querySelector('[data-bs-toggle="dropdown"]');
    if (!menu || !toggle) return;

    dropdown.addEventListener('shown.bs.dropdown', () => {
      if (desktop.matches || !actions.classList.contains('mobile-sidebar-actions')) return;
      menu.classList.add('mobile-dropdown-overlay');

      const rect = toggle.getBoundingClientRect();
      const maxHeight = Math.min(window.innerHeight * 0.6, 416);
      const menuHeight = Math.min(menu.scrollHeight, maxHeight);
      let top = rect.bottom + 8;
      if (top + menuHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuHeight - 8);
      }
      menu.style.setProperty('top', `${top}px`, 'important');
    });

    dropdown.addEventListener('hidden.bs.dropdown', () => {
      menu.classList.remove('mobile-dropdown-overlay');
      menu.removeAttribute('style');
    });
  });
})();

document.querySelectorAll('[data-notification-read]').forEach((notificationButton) => {
  notificationButton.addEventListener('click', async () => {
    if (notificationButton.getAttribute('aria-pressed') === 'true') return;
    notificationButton.disabled = true;
    try {
      const response = await fetch(notificationButton.dataset.readUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRF-TOKEN': @json(csrf_token()),
        },
      });
      if (!response.ok) throw new Error();

      const matchingButtons = [...document.querySelectorAll('[data-notification-id]')]
        .filter((button) => button.dataset.notificationId === notificationButton.dataset.notificationId);
      const wasUnread = matchingButtons.some((button) => button.getAttribute('aria-pressed') !== 'true');
      matchingButtons.forEach((button) => {
        button.classList.add('text-muted');
        button.setAttribute('aria-pressed', 'true');
        button.querySelector('.badge')?.remove();
      });

      if (wasUnread) {
        const count = document.querySelector('[data-notification-count]');
        const countValue = count?.querySelector('[data-count-value]');
        const remaining = Math.max(0, Number(countValue?.textContent || 0) - 1);
        if (countValue) countValue.textContent = String(remaining);
        if (remaining === 0) count?.remove();
      }
    } catch (error) {
      window.showBootstrapAlert('تعذر وضع الإشعار كمقروء. حاول مرة أخرى.', 'danger');
    } finally {
      notificationButton.disabled = false;
    }
  });
});
</script>
@endpush
