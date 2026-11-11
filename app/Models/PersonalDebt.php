<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PersonalDebt extends Model
{
    protected $fillable = [
        'creditor', 'description', 'total_amount', 'paid_amount', 'remaining',
        'due_date', 'status', 'notes', 'created_by',
    ];

    protected function casts(): array
    {
        return ['due_date' => 'date'];
    }

    public function payments(): HasMany
    {
        return $this->hasMany(PersonalDebtPayment::class);
    }
}
