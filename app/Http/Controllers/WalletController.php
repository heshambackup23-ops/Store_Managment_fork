<?php

namespace App\Http\Controllers;

use App\Http\Requests\SaveWalletRequest;
use App\Models\Wallet;
use App\Services\Wallets\WalletLedgerService;
use App\Support\Money;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

class WalletController extends Controller
{
    public function index(WalletLedgerService $ledger)
    {
        $wallets = Wallet::query()->orderByDesc('is_active')->orderBy('name')->orderBy('id')
            ->paginate(12, ['*'], 'wallets_page')->withQueryString();
        $usage = $ledger->usageForWallets($wallets->getCollection()); // one query for this page

        $cards = $wallets->through(fn (Wallet $wallet): array => [
            'wallet' => $wallet,
            'rows' => $ledger->limitRows($wallet, $usage[$wallet->id]),
        ]);

        $summary = [
            'wallets_total' => Money::cents(Wallet::query()->sum('balance')),
            'cash' => $ledger->cashInDrawer(),
            'profit_today' => $ledger->profitSince(now()->startOfDay()),
            'profit_available' => $ledger->profitAvailable(),
            'capital' => $ledger->workingCapital(),
        ];

        // Daily and monthly limits reset at local midnight; UTC would shift that by hours.
        $timezoneWarning = config('app.timezone') === 'UTC';

        return view('wallets.index', compact('cards', 'summary', 'timezoneWarning'));
    }

    public function create()
    {
        return view('wallets.form', ['wallet' => new Wallet([
            'warn_at_percent' => 80,
            'is_active' => true,
        ])]);
    }

    public function store(SaveWalletRequest $request, WalletLedgerService $ledger): RedirectResponse
    {
        $data = $request->walletAttributes();
        $opening = Money::decimal(Money::cents($data['opening_balance'] ?? 0));

        DB::transaction(function () use ($data, $opening, $request, $ledger): void {
            $wallet = new Wallet();
            $wallet->fill(Arr::except($data, ['opening_balance']));
            $wallet->forceFill(['opening_balance' => $opening, 'balance' => $opening])->save();

            $ledger->audit($request->user(), 'wallet.created', 'wallet', $wallet->id, [
                'provider' => $wallet->provider,
                'opening_balance' => $opening,
            ], $request->ip());
        });

        return redirect()->route('wallets.index')->with('success', 'تمت إضافة المحفظة بنجاح.');
    }

    public function edit(Wallet $wallet)
    {
        return view('wallets.form', compact('wallet'));
    }

    public function update(SaveWalletRequest $request, Wallet $wallet, WalletLedgerService $ledger): RedirectResponse
    {
        $wallet->fill($request->walletAttributes());
        $changes = array_keys($wallet->getDirty());
        $wallet->save();

        $ledger->audit($request->user(), 'wallet.updated', 'wallet', $wallet->id, ['changed' => $changes], $request->ip());

        return redirect()->route('wallets.index')->with('success', 'تم تحديث بيانات المحفظة.');
    }

    public function toggle(Request $request, Wallet $wallet, WalletLedgerService $ledger): RedirectResponse
    {
        $wallet->forceFill(['is_active' => ! $wallet->is_active])->save();
        $ledger->audit($request->user(), $wallet->is_active ? 'wallet.activated' : 'wallet.deactivated', 'wallet', $wallet->id, [], $request->ip());

        return back()->with('success', $wallet->is_active ? 'تم تفعيل المحفظة.' : 'تم إيقاف المحفظة.');
    }

    public function adjust(Request $request, Wallet $wallet, WalletLedgerService $ledger): RedirectResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'decimal:0,2', 'not_in:0', 'between:-99999999,99999999'],
            'reason' => ['required', 'string', 'min:3', 'max:255'],
        ], [], ['amount' => 'مبلغ التسوية', 'reason' => 'سبب التسوية']);

        $ledger->adjust($wallet, $data['amount'], $data['reason'], $request->user(), $request->ip());

        return back()->with('success', 'تم تسجيل تسوية الرصيد.');
    }
}
