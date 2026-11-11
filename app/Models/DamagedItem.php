<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class DamagedItem extends Model
{
    public const REASONS = [
        'broken' => 'كسر',
        'water' => 'تلف بالمياه',
        'defective' => 'عيب تصنيع',
        'not_working' => 'لا يعمل',
        'lost' => 'فقد / سرقة',
        'expired' => 'منتهي الصلاحية',
        'returned' => 'مرتجع تالف',
        'other' => 'أخرى',
    ];

    /** Only void bookkeeping may change after a record is created. */
    private const MUTABLE = ['status', 'voided_at', 'voided_by', 'void_reason', 'updated_at'];

    /** Fields a manager may correct through DamagedStockService::update() (never directly). */
    private const EDITABLE = ['quantity', 'unit_value', 'total_value', 'reason', 'notes', 'damaged_on', 'stock_after'];

    private static bool $serviceEditing = false;

    /**
     * Runs a correction on an active record. Only DamagedStockService uses this,
     * inside the transaction that also moves the product stock.
     */
    public static function whileServiceEditing(callable $callback): mixed
    {
        self::$serviceEditing = true;

        try {
            return $callback();
        } finally {
            self::$serviceEditing = false;
        }
    }

    /** Nothing is mass assignable; the services write rows with forceCreate()/forceFill(). */
    protected $guarded = ['*'];

    protected function casts(): array
    {
        return [
            'damaged_on' => 'date',
            'voided_at' => 'datetime',
            'quantity' => 'integer',
            'stock_before' => 'integer',
            'stock_after' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (self $item): void {
            $allowed = self::$serviceEditing && ! $item->isVoided()
                ? array_merge(self::MUTABLE, self::EDITABLE)
                : self::MUTABLE;
            $illegal = array_diff(array_keys($item->getDirty()), $allowed);

            if ($illegal !== []) {
                throw new LogicException('Damaged-stock records can only be corrected through the damaged-stock service. Void the record and add a new one for anything else.');
            }
        });

        static::deleting(function (): void {
            throw new LogicException('Damaged-stock records are never deleted. Void the record instead.');
        });
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(products::class, 'product_id');
    }

    public function reasonLabel(): string
    {
        return self::REASONS[$this->reason] ?? $this->reason;
    }

    public function isVoided(): bool
    {
        return $this->status === 'voided';
    }
}
