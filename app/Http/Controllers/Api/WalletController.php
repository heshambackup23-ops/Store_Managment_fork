<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\CreateWalletRequest;
use App\Http\Requests\Api\AdjustWalletRequest;
use App\Http\Requests\Api\ToggleWalletRequest;
use App\Models\Wallet;
use App\Services\ApiIdempotencyService;
use App\Services\Wallets\WalletLedgerService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

class WalletController
{
    public function store(CreateWalletRequest $request, ApiIdempotencyService $idempotency): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);
        $opening = Money::decimal(Money::cents($data['opening_balance'] ?? 0));

        return $idempotency->execute(
            $request->user(),
            'wallets.create',
            $key,
            $data,
            function () use ($data, $opening, $request): array {
                $wallet = DB::transaction(function () use ($data, $opening, $request): Wallet {
                    $wallet = new Wallet();
                    $wallet->fill(Arr::except($data, ['opening_balance']));
                    $wallet->forceFill(['opening_balance' => $opening, 'balance' => $opening])->save();
                    app(WalletLedgerService::class)->audit($request->user(), 'wallet.created', 'wallet', $wallet->id, [
                        'provider' => $wallet->provider,
                        'opening_balance' => $opening,
                    ], $request->ip());

                    return $wallet;
                });

                return ['status' => 201, 'body' => ['data' => ['id' => $wallet->id]]];
            }
        );
    }

    public function toggle(ToggleWalletRequest $request, Wallet $wallet, ApiIdempotencyService $idempotency, WalletLedgerService $ledger): JsonResponse
    {
        $key = $request->validated('idempotency_key');
        $data = ['wallet_id' => $wallet->id];

        return $idempotency->execute(
            $request->user(),
            'wallets.toggle',
            (string) $key,
            $data,
            function () use ($request, $wallet, $ledger): array {
                $wallet->forceFill(['is_active' => ! $wallet->is_active])->save();
                $ledger->audit($request->user(), $wallet->is_active ? 'wallet.activated' : 'wallet.deactivated', 'wallet', $wallet->id, [], $request->ip());

                return ['status' => 200, 'body' => ['data' => ['id' => $wallet->id, 'is_active' => $wallet->is_active]]];
            }
        );
    }

    public function adjust(AdjustWalletRequest $request, Wallet $wallet, ApiIdempotencyService $idempotency, WalletLedgerService $ledger): JsonResponse
    {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'wallets.adjust',
            $key,
            ['wallet_id' => $wallet->id] + $data,
            function () use ($request, $wallet, $ledger, $data): array {
                $transaction = $ledger->adjust($wallet, $data['amount'], $data['reason'], $request->user(), $request->ip());

                return ['status' => 201, 'body' => ['data' => ['id' => $transaction->id]]];
            }
        );
    }

    public function index(Request $request, WalletLedgerService $ledger): JsonResponse
    {
        $wallets = Wallet::query()
            ->orderByDesc('is_active')
            ->orderBy('name')
            ->orderBy('id')
            ->get();
        $usage = $ledger->usageForWallets($wallets);

        return response()->json([
            'data' => [
                'summary' => [
                    'wallets_total' => Money::decimal(Money::cents($wallets->sum('balance'))),
                    'cash' => Money::decimal($ledger->cashInDrawer()),
                    'profit_today' => Money::decimal($ledger->profitSince(now()->startOfDay())),
                    'profit_available' => Money::decimal($ledger->profitAvailable()),
                    'receivables' => Money::decimal($ledger->receivablesTotal()),
                    'capital' => Money::decimal($ledger->workingCapital()),
                ],
                'wallets' => $wallets->map(function ($wallet) use ($ledger, $usage): array {
                    $limits = array_map(static function (array $row): array {
                        return [
                            'label' => $row['label'],
                            'used' => Money::decimal($row['used']),
                            'limit' => $row['limit'] === null ? null : Money::decimal($row['limit']),
                            'remaining' => $row['remaining'] === null ? null : Money::decimal($row['remaining']),
                            'percent' => $row['percent'],
                            'level' => $row['level'],
                        ];
                    }, $ledger->limitRows($wallet, $usage[$wallet->id]));

                    return [
                        'id' => $wallet->id,
                        'name' => $wallet->label(),
                        'provider' => $wallet->providerLabel(),
                        'identifier' => $wallet->identifier,
                        'balance' => Money::decimal(Money::cents($wallet->balance)),
                        'is_active' => $wallet->is_active,
                        'warn_at_percent' => $wallet->warn_at_percent,
                        'limits' => $limits,
                    ];
                })->values(),
            ],
        ]);
    }
}
