<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WalletExpense extends Model
{
    /** Nothing is mass assignable; the services write rows with forceCreate()/forceFill(). */
    protected $guarded = ['*'];

    protected function casts(): array
    {
        return [
            'spent_on' => 'date',
            'voided_at' => 'datetime',
        ];
    }

    /** Only the void bookkeeping may change; an expense is cancelled, never edited or deleted. */
    protected static function booted(): void
    {
        static::updating(function (self $expense): void {
            $illegal = array_diff(array_keys($expense->getDirty()), ['voided_at', 'voided_by', 'void_reason', 'updated_at']);

            if ($illegal !== []) {
                throw new \LogicException('Expenses can not be edited: '.implode(', ', $illegal));
            }
        });

        static::deleting(function (): void {
            throw new \LogicException('Expenses can never be deleted. Void the expense instead.');
        });
    }
}
