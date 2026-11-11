<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class PersonalDebtPayment extends Model
{
    protected $guarded = ['*'];

    protected function casts(): array
    {
        return ['paid_on' => 'date'];
    }

    protected static function booted(): void
    {
        static::updating(function (): never {
            throw new LogicException('Personal-debt payment rows are immutable.');
        });

        static::deleting(function (): never {
            throw new LogicException('Personal-debt payment rows are immutable.');
        });
    }

    public function debt(): BelongsTo
    {
        return $this->belongsTo(PersonalDebt::class, 'personal_debt_id');
    }
}
