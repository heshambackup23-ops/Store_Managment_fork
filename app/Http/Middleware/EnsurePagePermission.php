<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Laravel\Sanctum\TransientToken;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

class EnsurePagePermission
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->bearerToken() === null) {
            Auth::shouldUse('web');
        }

        $user = $request->bearerToken()
            ? $request->user()
            : (Auth::guard('web')->user() ?? $request->user());
        $route = $request->route();
        $routeName = $route?->getName();
        $module = $routeName === 'home' ? 'dashboard' : Str::before((string) $routeName, '.');

        if ($module === 'users') {
            $module = 'staff';
        } elseif ($module === 'admin') {
            $module = 'notifications';
        } elseif ($module === 'personal-debts') {
            $module = 'installments';
        }

        // Every signed-in, active user can view and edit THEIR OWN profile (details,
        // password, picture), whatever their role says. ProfileSettingsController only
        // ever acts on the authenticated user, and edit() rejects any other id.
        // The superadmin-only role route (profile.users.*) is NOT exempt.
        $selfService = $module === 'profile'
            && $request->bearerToken() === null
            && !str_starts_with((string) $routeName, 'profile.users.');

        if (!$user || (!$selfService && !array_key_exists($module, config('access.pages', [])))) {
            abort(403);
        }

        if (!$user->is_active) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
            abort(403);
        }

        if ($selfService) {
            return $next($request);
        }

        $action = $route?->getActionMethod();
        $personalNotificationWrite = in_array($action, ['markRead', 'markAllRead'], true);
        $manage = (!$request->isMethodSafe() && !$personalNotificationWrite)
            || in_array($action, ['create', 'edit', 'showPay'], true);
        $ability = $manage ? 'manage' : 'view';
        $permission = "page.{$module}.{$ability}";
        $allowed = $user->can($permission)
            || (!$manage && $user->can("page.{$module}.manage"));

        if (!$allowed) {
            abort(403);
        }

        $token = $user->currentAccessToken();
        $bearerToken = $request->bearerToken();
        if ($bearerToken !== null) {
            $token = PersonalAccessToken::findToken($bearerToken);

            if (!$token || (string) $token->tokenable_id !== (string) $user->getAuthIdentifier()
                || $token->tokenable_type !== $user->getMorphClass()
                || !$token->can($permission)) {
                abort(403);
            }
        } elseif ($token !== null && !$token instanceof TransientToken && !$token->can($permission)) {
            abort(403);
        }

        return $next($request);
    }
}
