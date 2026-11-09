<?php

namespace App\Http\Controllers;

use App\Models\WalletAuditLog;
use App\Support\AuditPresenter;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Who did what, when, from where, in readable Arabic. Superadmin only. */
class WalletAuditController extends Controller
{
    public function index(Request $request)
    {
        abort_unless($request->user()->isSuperAdmin(), 403);

        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:80'],
            'action' => ['nullable', Rule::in(array_keys(AuditPresenter::ACTIONS))],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
        ]);

        $term = trim((string) ($filters['q'] ?? ''));

        $logs = WalletAuditLog::query()
            ->when($term !== '', function ($query) use ($term) {
                $like = '%'.addcslashes($term, '%_\\').'%';
                $actions = AuditPresenter::actionsMatching($term);
                $subjects = AuditPresenter::subjectsMatching($term);

                $query->where(function ($search) use ($like, $term, $actions, $subjects) {
                    $search->where('user_name', 'like', $like)
                        ->orWhere('ip', 'like', $like)
                        ->orWhereRaw('CAST(meta AS CHAR) LIKE ?', [$like]);

                    if ($actions !== []) {
                        $search->orWhereIn('action', $actions);
                    }
                    if ($subjects !== []) {
                        $search->orWhereIn('subject_type', $subjects);
                    }
                    if (ctype_digit(ltrim($term, '#'))) {
                        $search->orWhere('subject_id', (int) ltrim($term, '#'));
                    }
                });
            })
            ->when(! empty($filters['action']), fn ($query) => $query->where('action', $filters['action']))
            ->when(! empty($filters['from']), fn ($query) => $query->whereDate('created_at', '>=', $filters['from']))
            ->when(! empty($filters['to']), fn ($query) => $query->whereDate('created_at', '<=', $filters['to']))
            ->latest('id')
            ->paginate(50)
            ->withQueryString()
            ->through(fn (WalletAuditLog $log) => AuditPresenter::row($log));

        return view('wallets.audit', [
            'logs' => $logs,
            'filters' => $filters,
            'actions' => AuditPresenter::ACTIONS,
        ]);
    }
}
