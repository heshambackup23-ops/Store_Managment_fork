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
            $illegal = array_diff(array_keys($item->getDirty()), self::MUTABLE);

            if ($illegal !== []) {
                throw new LogicException('Damaged-stock records cannot be edited. Void the record and add a new one.');
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
