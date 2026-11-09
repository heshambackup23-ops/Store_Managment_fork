<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class WalletAuditLog extends Model
{
    public $timestamps = false;

    /** Nothing is mass assignable; the services write rows with forceCreate()/forceFill(). */
    protected $guarded = ['*'];

    protected function casts(): array
    {
        return ['meta' => 'array', 'created_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(function (): void {
            throw new \LogicException('WalletAuditLog rows are history and can never be edited.');
        });

        static::deleting(function (): void {
            throw new \LogicException('WalletAuditLog rows are history and can never be deleted.');
        });
    }
}
