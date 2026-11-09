<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;
use LogicException;

/**
 * Append-only ledger row. Once written, money columns can never change and the
 * row can never be deleted. Corrections are made with a reversal row.
 */
class WalletTransaction extends Model
{
    /** Only these columns may change after creation (reversal / settlement bookkeeping). */
    private const MUTABLE = [
        'status', 'reversed_at', 'reversed_by', 'reversal_reason',
        'receivable', 'settled_at', 'updated_at',
    ];

    /** Nothing is mass assignable; the services write rows with forceCreate()/forceFill(). */
    protected $guarded = ['*'];

    protected function casts(): array
    {
        return [
            'occurred_at' => 'datetime',
            'reversed_at' => 'datetime',
            'settled_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $transaction): void {
            if (empty($transaction->uuid)) {
                $transaction->uuid = (string) Str::uuid();
            }
        });

        static::updating(function (self $transaction): void {
            $illegal = array_diff(array_keys($transaction->getDirty()), self::MUTABLE);

            if ($illegal !== []) {
                throw new LogicException('Wallet ledger rows are immutable: '.implode(', ', $illegal));
            }
        });

        static::deleting(function (): void {
            throw new LogicException('Wallet ledger rows can never be deleted. Reverse the transaction instead.');
        });
    }

    /** Public URLs use the uuid, never the sequential id. */
    public function getRouteKeyName(): string
    {
        return 'uuid';
    }

    public function wallet(): BelongsTo
    {
        return $this->belongsTo(Wallet::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(customers::class, 'customer_id');
    }

    public function isMoneyMovement(): bool
    {
        return in_array($this->type, ['send', 'receive'], true);
    }
}
