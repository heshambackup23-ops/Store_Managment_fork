<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WalletCashAdjustment extends Model
{
    /** Nothing is mass assignable; the services write rows with forceCreate()/forceFill(). */
    protected $guarded = ['*'];

    protected function casts(): array
    {
        return ['occurred_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(function (): void {
            throw new \LogicException('WalletCashAdjustment rows are history and can never be edited.');
        });

        static::deleting(function (): void {
            throw new \LogicException('WalletCashAdjustment rows are history and can never be deleted.');
        });
    }
}
