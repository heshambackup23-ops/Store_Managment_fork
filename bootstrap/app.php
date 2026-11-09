<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use App\Http\Middleware\EnsureUserHasRole;
use App\Http\Middleware\AddSecurityHeaders;
use App\Http\Middleware\EnsurePagePermission;
use App\Http\Middleware\EnsureSuperadmin;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Http\Middleware\CheckAbilities;
use Laravel\Sanctum\Http\Middleware\CheckForAnyAbility;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->append(AddSecurityHeaders::class);
        $middleware->statefulApi();
        $middleware->redirectGuestsTo('/showLogin');
        $middleware->redirectUsersTo('/');
         $middleware->alias([
            'auth' => \Illuminate\Auth\Middleware\Authenticate::class,
            'role' => EnsureUserHasRole::class,
            'page.access' => EnsurePagePermission::class,
            'superadmin' => EnsureSuperadmin::class,
                'abilities' => CheckAbilities::class,
                'ability' => CheckForAnyAbility::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (Throwable $exception, Request $request) {
            if ($exception instanceof ValidationException) {
                if ($request->is('api/*')) {
                    return response()->json([
                        'message' => 'The given data was invalid.',
                        'error_code' => 'VALIDATION_FAILED',
                        'errors' => $exception->errors(),
                    ], 422);
                }

                return null;
            }

            if ($exception instanceof AuthenticationException && !$request->expectsJson()) {
                return null;
            }

            $status = $exception instanceof AuthenticationException
                ? 401
                : ($exception instanceof HttpExceptionInterface ? $exception->getStatusCode() : 500);

            $messages = [
                401 => 'You need to sign in to access this page.',
                403 => 'You do not have permission to access this page.',
                404 => 'The page you requested could not be found.',
                419 => 'Your session expired. Please return and try again.',
                429 => 'Too many requests. Please wait and try again.',
                500 => 'Something went wrong on our side. Please try again later.',
                503 => 'The service is temporarily unavailable. Please try again later.',
            ];

            $message = $messages[$status] ?? 'The request could not be completed.';

            if ($request->expectsJson() || $request->ajax() || $request->is('api/*')) {
                $errorCodes = [
                    400 => 'BAD_REQUEST',
                    401 => 'AUTHENTICATION_REQUIRED',
                    403 => 'PERMISSION_DENIED',
                    404 => 'RESOURCE_NOT_FOUND',
                    409 => 'CONFLICT',
                    429 => 'RATE_LIMITED',
                    500 => 'INTERNAL_SERVER_ERROR',
                    503 => 'SERVICE_UNAVAILABLE',
                ];

                return response()->json([
                    'error' => true,
                    'message' => $message,
                    'error_code' => $errorCodes[$status] ?? 'REQUEST_FAILED',
                    'status' => $status,
                ], $status);
            }

            $referer = $request->headers->get('referer');
            $refererParts = $referer ? parse_url($referer) : false;
            $sameOriginReferer = is_array($refererParts)
                && in_array(strtolower($refererParts['scheme'] ?? ''), ['http', 'https'], true)
                && hash_equals($request->getHost(), $refererParts['host'] ?? '')
                && !isset($refererParts['user'], $refererParts['pass']);
            $previousUrl = $sameOriginReferer
                ? $referer
                : route($request->user() ? 'home' : 'showLogin');

            return response()->view(
                view()->exists("errors.{$status}") ? "errors.{$status}" : 'errors.generic',
                compact('status', 'message', 'previousUrl'),
                $status
            );
        });
    })->create();
