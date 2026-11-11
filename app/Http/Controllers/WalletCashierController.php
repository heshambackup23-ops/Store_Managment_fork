<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreWalletTransactionRequest;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Services\Wallets\WalletLedgerService;
use App\Support\Money;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class WalletCashierController extends Controller
{
    public function index(Request $request, WalletLedgerService $ledger)
    {
        $wallets = Wallet::query()->where('is_active', true)->orderBy('name')->orderBy('id')->get();

        $usage = $ledger->usageForWallets($wallets); // one query for every wallet

        // Everything the browser needs for the live limit preview, in cents.
        $walletData = $wallets->map(function (Wallet $wallet) use ($usage): array {
            return [
                'id' => $wallet->id,
                'name' => $wallet->label(),
                'provider' => $wallet->providerLabel(),
                'identifier' => $wallet->identifier ?? '',
                'balance' => Money::cents($wallet->balance),
                'perTransaction' => $wallet->limitCents('per_transaction_limit'),
                'limits' => [
                    'sent_day' => $wallet->limitCents('daily_send_limit'),
                    'sent_month' => $wallet->limitCents('monthly_send_limit'),
                    'received_day' => $wallet->limitCents('daily_receive_limit'),
                    'received_month' => $wallet->limitCents('monthly_receive_limit'),
                ],
                'usage' => $usage[$wallet->id],
                'warn' => (int) $wallet->warn_at_percent,
                'commission' => [
                    'percent' => (float) $wallet->default_commission_percent,
                    'min' => Money::cents($wallet->default_commission_min),
                ],
                'fee' => [
                    'percent' => (float) $wallet->default_fee_percent,
                    'min' => Money::cents($wallet->default_fee_min),
                    'max' => $wallet->default_fee_max !== null ? Money::cents($wallet->default_fee_max) : null,
                ],
            ];
        })->values();

        $selectedWallet = (int) $request->query('wallet', $walletData->first()['id'] ?? 0);
        $selectedType = $request->query('type') === 'receive' ? 'receive' : 'send';

        $recent = WalletTransaction::query()
            ->with('wallet:id,name,provider,identifier')
            ->whereIn('type', ['send', 'receive'])
            ->latest('occurred_at')->latest('id')
            ->paginate(20, ['*'], 'transactions_page')->withQueryString();

        $outstanding = Money::cents(
            WalletTransaction::query()->where('status', 'completed')->where('receivable', '>', 0)->sum('receivable')
        );

        return view('wallet_cashier.index', compact('walletData', 'selectedWallet', 'selectedType', 'recent', 'outstanding'));
    }

    /** Every deferred transfer that is still not fully collected, grouped by customer. */
    public function debts(WalletLedgerService $ledger)
    {
        $baseQuery = WalletTransaction::query()
            ->where('status', 'completed')
            ->where('payment_method', 'deferred')
            ->where('receivable', '>', 0);
        $customers = (clone $baseQuery)
            ->select('customer_name')
            ->distinct()
            ->orderBy('customer_name')
            ->paginate(20, ['customer_name'], 'customers_page')
            ->withQueryString();

        $names = $customers->getCollection()->pluck('customer_name');
        $rowsQuery = WalletTransaction::query()
            ->with('wallet:id,name,provider,identifier')
            ->where('status', 'completed')
            ->where('payment_method', 'deferred')
            ->where('receivable', '>', 0)
            ->where(function ($query) use ($names): void {
                $named = $names->filter(fn ($name) => $name !== null && $name !== '')->values();
                if ($named->isNotEmpty()) {
                    $query->whereIn('customer_name', $named);
                }
                if ($names->contains(null) || $names->contains('')) {
                    $query->orWhereNull('customer_name')->orWhere('customer_name', '');
                }
            })
            ->orderBy('occurred_at')->orderBy('id');
        $rows = $names->isEmpty() ? collect() : (clone $rowsQuery)->limit(501)->get();
        $truncated = $rows->count() > 500;
        if ($truncated) {
            $rows = $rows->take(500);
        }

        $groups = $rows->groupBy(fn (WalletTransaction $transaction) => $transaction->customer_name ?: 'بدون اسم');
        $total = $ledger->receivablesTotal();

        return view('wallet_cashier.debts', compact('groups', 'customers', 'total', 'truncated'));
    }

    public function store(StoreWalletTransactionRequest $request, WalletLedgerService $ledger): RedirectResponse
    {
        $transaction = $ledger->record($request->validated(), $request->user(), $request->ip());

        return redirect()
            ->route('wallet_cashier.index', ['wallet' => $transaction->wallet_id, 'type' => $transaction->type])
            ->with('success', 'تم تسجيل العملية بنجاح.');
    }

    public function reverse(Request $request, WalletTransaction $transaction, WalletLedgerService $ledger): RedirectResponse
    {
        // Undoing a transaction is a manager action, separate from operating the cashier.
        abort_unless($request->user()->can('page.wallets.manage'), 403);

        $data = $request->validate(
            ['reason' => ['required', 'string', 'min:3', 'max:255']],
            [],
            ['reason' => 'سبب العكس']
        );

        $ledger->reverse($transaction, $data['reason'], $request->user(), $request->ip());

        return back()->with('success', 'تم عكس العملية وتسجيل قيد عكسي. لم يُحذف أي سجل.');
    }

    public function settle(Request $request, WalletTransaction $transaction, WalletLedgerService $ledger): RedirectResponse
    {
        $data = $request->validate(
            ['amount' => ['nullable', 'numeric', 'decimal:0,2', 'min:0.01', 'max:99999999']],
            [],
            ['amount' => 'مبلغ التحصيل']
        );

        $ledger->settle($transaction, $data['amount'] ?? null, $request->user(), $request->ip());

        return back()->with('success', 'تم تسجيل التحصيل.');
    }
}
