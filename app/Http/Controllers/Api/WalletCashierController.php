<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\CreateWalletTransactionRequest;
use App\Http\Requests\Api\ReverseWalletTransactionRequest;
use App\Http\Requests\Api\SettleWalletTransactionRequest;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Services\ApiIdempotencyService;
use App\Services\Wallets\WalletLedgerService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class WalletCashierController
{
    public function index(Request $request, WalletLedgerService $ledger): JsonResponse
    {
        $wallets = Wallet::query()->where('is_active', true)->orderBy('name')->orderBy('id')->get();
        $transactions = WalletTransaction::query()
            ->with('wallet:id,name,provider,identifier')
            ->whereIn('type', ['send', 'receive'])
            ->latest('occurred_at')->latest('id')
            ->limit(50)
            ->get();

        return response()->json(['data' => [
            'wallets' => $wallets->map(fn (Wallet $wallet): array => [
                'id' => $wallet->id,
                'name' => $wallet->label(),
                'provider' => $wallet->providerLabel(),
                'identifier' => $wallet->identifier,
                'balance' => Money::decimal(Money::cents($wallet->balance)),
                'per_transaction_limit' => $wallet->limitCents('per_transaction_limit') === null
                    ? null
                    : Money::decimal($wallet->limitCents('per_transaction_limit')),
                'default_commission_percent' => number_format((float) $wallet->default_commission_percent, 2, '.', ''),
                'default_commission_min' => Money::decimal(Money::cents($wallet->default_commission_min)),
                'default_fee_percent' => number_format((float) $wallet->default_fee_percent, 2, '.', ''),
                'default_fee_min' => Money::decimal(Money::cents($wallet->default_fee_min)),
                'default_fee_max' => $wallet->default_fee_max === null
                    ? null
                    : Money::decimal(Money::cents($wallet->default_fee_max)),
            ])->values(),
            'transactions' => $transactions->map(fn (WalletTransaction $transaction): array => [
                'uuid' => $transaction->uuid,
                'wallet_id' => $transaction->wallet_id,
                'wallet_name' => $transaction->wallet?->label(),
                'type' => $transaction->type,
                'status' => $transaction->status,
                'amount' => Money::decimal(Money::cents($transaction->amount)),
                'commission' => Money::decimal(Money::cents($transaction->commission)),
                'fee' => Money::decimal(Money::cents($transaction->fee)),
                'counterparty' => $transaction->counterparty,
                'customer_name' => $transaction->customer_name,
                'payment_method' => $transaction->payment_method,
                'receivable' => Money::decimal(Money::cents($transaction->receivable)),
                'occurred_at' => $transaction->occurred_at?->toIso8601String(),
                'can_settle' => $transaction->status === 'completed'
                    && $transaction->payment_method === 'deferred'
                    && Money::cents($transaction->receivable) > 0,
                'can_reverse' => $transaction->status === 'completed'
                    && $transaction->isMoneyMovement(),
            ])->values(),
            'outstanding' => Money::decimal($ledger->receivablesTotal()),
        ]]);
    }

    public function store(
        CreateWalletTransactionRequest $request,
        ApiIdempotencyService $idempotency,
        WalletLedgerService $ledger,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        $data['idempotency_key'] = $key;

        return $idempotency->execute(
            $request->user(),
            'wallet-cashier.create',
            $key,
            $data,
            function () use ($request, $ledger, $data): array {
                $transaction = $ledger->record($data, $request->user(), $request->ip());

                return ['status' => 201, 'body' => ['data' => ['uuid' => $transaction->uuid]]];
            }
        );
    }

    public function settle(
        SettleWalletTransactionRequest $request,
        WalletTransaction $transaction,
        ApiIdempotencyService $idempotency,
        WalletLedgerService $ledger,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'wallet-cashier.settle',
            $key,
            ['transaction_uuid' => $transaction->uuid] + $data,
            function () use ($request, $transaction, $ledger, $data): array {
                $settlement = $ledger->settle($transaction, $data['amount'] ?? null, $request->user(), $request->ip());

                return ['status' => 201, 'body' => ['data' => ['uuid' => $settlement->uuid]]];
            }
        );
    }

    public function reverse(
        ReverseWalletTransactionRequest $request,
        WalletTransaction $transaction,
        ApiIdempotencyService $idempotency,
        WalletLedgerService $ledger,
    ): JsonResponse {
        $data = $request->validated();
        $key = $data['idempotency_key'];
        unset($data['idempotency_key']);

        return $idempotency->execute(
            $request->user(),
            'wallet-cashier.reverse',
            $key,
            ['transaction_uuid' => $transaction->uuid] + $data,
            function () use ($request, $transaction, $ledger, $data): array {
                $reversal = $ledger->reverse($transaction, $data['reason'], $request->user(), $request->ip());

                return ['status' => 201, 'body' => ['data' => ['uuid' => $reversal->uuid]]];
            }
        );
    }
}
