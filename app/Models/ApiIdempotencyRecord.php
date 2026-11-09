<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ApiIdempotencyRecord extends Model
{
    protected $fillable = [
        'user_id',
        'operation',
        'idempotency_key',
        'request_hash',
        'response_status',
        'response_body',
    ];

    protected function casts(): array
    {
        return [
            'response_status' => 'integer',
            'response_body' => 'array',
        ];
    }
}
