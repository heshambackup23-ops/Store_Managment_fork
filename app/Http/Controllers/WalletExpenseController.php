<?php

namespace App\Http\Controllers;

use App\Models\Wallet;
use App\Models\WalletCashAdjustment;
use App\Models\WalletExpense;
use App\Services\Wallets\WalletLedgerService;
use App\Support\Digits;
use App\Support\Money;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Shop expenses and cash-drawer entries (opening cash, owner deposit/withdrawal, corrections).
 * Expenses lower both the cash drawer and the net profit. Records are voided, never deleted.
 */
class WalletExpenseController extends Controller
{
    public const CATEGORIES = ['إيجار', 'كهرباء', 'رواتب', 'مواصلات', 'صيانة', 'نثريات', 'أخرى'];

    public const CASH_KINDS = [
        'opening' => 'رصيد افتتاحي للدرج',
        'owner_deposit' => 'إيداع من المالك',
        'owner_withdraw' => 'سحب للمالك',
        'correction' => 'تسوية (+ أو -)',
    ];

    public function index(Request $request, WalletLedgerService $ledger)
    {
        $filters = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
        ]);

        $from = $filters['from'] ?? now()->startOfMonth()->toDateString();
        $to = $filters['to'] ?? now()->toDateString();

        $range = fn () => WalletExpense::query()
            ->whereDate('spent_on', '>=', $from)
            ->whereDate('spent_on', '<=', $to);

        return view('wallets.expenses', [
            'expenses' => $range()->orderByDesc('spent_on')->orderByDesc('id')->paginate(25)->withQueryString(),
            'rangeTotal' => Money::cents($range()->whereNull('voided_at')->sum('amount')),
            'cash' => $ledger->cashInDrawer(),
            'adjustments' => WalletCashAdjustment::query()->latest('occurred_at')->latest('id')->limit(15)->get(),
            'categories' => self::CATEGORIES,
            'cashKinds' => self::CASH_KINDS,
            'kindLabels' => self::CASH_KINDS + ['profit_withdraw' => 'سحب أرباح'],
            'profitAvailable' => $ledger->profitAvailable(),
            'walletOptions' => Wallet::query()->orderBy('name')->orderBy('id')->get(),
            'from' => $from,
            'to' => $to,
        ]);
    }

    public function store(Request $request, WalletLedgerService $ledger): RedirectResponse
    {
        $request->merge(['amount' => trim((string) Digits::ascii((string) $request->input('amount')))]);

        $data = $request->validate([
            'category' => ['required', 'string', 'max:60'],
            'amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:99999999'],
            'spent_on' => ['required', 'date', 'before_or_equal:today'],
            'note' => ['nullable', 'string', 'max:500'],
        ], [], ['category' => 'البند', 'amount' => 'المبلغ', 'spent_on' => 'التاريخ', 'note' => 'ملاحظة']);

        DB::transaction(function () use ($data, $request, $ledger): void {
            $expense = WalletExpense::query()->forceCreate([
                'category' => trim($data['category']),
                'amount' => Money::decimal(Money::cents($data['amount'])),
                'note' => isset($data['note']) ? trim($data['note']) : null,
                'spent_on' => $data['spent_on'],
                'created_by' => $request->user()->id,
                'created_by_name' => $request->user()->name,
            ]);

            $ledger->audit($request->user(), 'expense.created', 'wallet_expense', $expense->id, [
                'category' => $expense->category,
                'amount' => $expense->amount,
            ], $request->ip());
        });

        return back()->with('success', 'تم تسجيل المصروف وخصمه من الدرج.');
    }

    public function void(Request $request, WalletExpense $expense, WalletLedgerService $ledger): RedirectResponse
    {
        $data = $request->validate(
            ['reason' => ['required', 'string', 'min:3', 'max:255']],
            [],
            ['reason' => 'سبب الإلغاء']
        );

        DB::transaction(function () use ($expense, $data, $request, $ledger): void {
            $locked = WalletExpense::query()->lockForUpdate()->findOrFail($expense->id);

            if ($locked->voided_at !== null) {
                throw ValidationException::withMessages(['expense' => 'تم إلغاء هذا المصروف من قبل.']);
            }

            $locked->forceFill([
                'voided_at' => now(),
                'voided_by' => $request->user()->id,
                'void_reason' => trim($data['reason']),
            ])->save();

            $ledger->audit($request->user(), 'expense.voided', 'wallet_expense', $locked->id, ['reason' => $data['reason']], $request->ip());
        });

        return back()->with('success', 'تم إلغاء المصروف وإرجاع مبلغه إلى الدرج.');
    }

    /** Take profit out of the business, from the cash drawer or from one wallet. */
    public function withdrawProfit(Request $request, WalletLedgerService $ledger): RedirectResponse
    {
        $request->merge(['amount' => trim((string) Digits::ascii((string) $request->input('amount')))]);

        $sources = array_merge(['cash'], Wallet::query()->pluck('id')->map(fn ($id) => 'wallet:'.$id)->all());

        $data = $request->validate([
            'amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:99999999'],
            'source' => ['required', 'string', Rule::in($sources)],
            'note' => ['nullable', 'string', 'max:500'],
        ], [], ['amount' => 'المبلغ', 'source' => 'مصدر السحب', 'note' => 'ملاحظة']);

        $walletId = $data['source'] === 'cash' ? null : (int) substr($data['source'], 7);

        $ledger->withdrawProfit($data['amount'], $walletId, $data['note'] ?? null, $request->user(), $request->ip());

        return back()->with('success', 'تم تسجيل سحب الأرباح.');
    }

    public function storeCash(Request $request, WalletLedgerService $ledger): RedirectResponse
    {
        $request->merge(['amount' => trim((string) Digits::ascii((string) $request->input('amount')))]);

        $data = $request->validate([
            'kind' => ['required', Rule::in(array_keys(self::CASH_KINDS))],
            'amount' => ['required', 'numeric', 'decimal:0,2', 'not_in:0', 'between:-99999999,99999999'],
            'note' => ['nullable', 'string', 'max:500'],
        ], [], ['kind' => 'النوع', 'amount' => 'المبلغ', 'note' => 'ملاحظة']);

        $cents = Money::cents($data['amount']);

        // Only a correction may be negative; the other kinds fix the sign themselves.
        if ($data['kind'] !== 'correction' && $cents < 0) {
            throw ValidationException::withMessages(['amount' => 'اكتب المبلغ موجباً. النوع المختار يحدد الإشارة تلقائياً.']);
        }

        $signed = match ($data['kind']) {
            'owner_withdraw' => -abs($cents),
            'correction' => $cents,
            default => abs($cents),
        };

        DB::transaction(function () use ($data, $signed, $request, $ledger): void {
            $row = WalletCashAdjustment::query()->forceCreate([
                'kind' => $data['kind'],
                'amount' => Money::decimal($signed),
                'note' => isset($data['note']) ? trim($data['note']) : null,
                'occurred_at' => now(),
                'created_by' => $request->user()->id,
                'created_by_name' => $request->user()->name,
            ]);

            $ledger->audit($request->user(), 'cash.adjusted', 'wallet_cash_adjustment', $row->id, [
                'kind' => $data['kind'],
                'amount' => $row->amount,
            ], $request->ip());
        });

        return back()->with('success', 'تم تسجيل حركة الدرج.');
    }
}
