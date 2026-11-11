<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use App\Models\category;
use App\Models\invoice;
use App\Models\sales;
use App\Models\installments;
use App\Services\PictureStorageService;

class products extends Model
{
    protected $fillable = ['name', 'price', 'description', 'notes', 'barcode', 'stock', 'category_id', 'image'];

    public function getImageUrlAttribute(): ?string
    {
        return app(PictureStorageService::class)->productUrl($this, true);
    }

    public function category()
    {
        return $this->belongsTo(category::class, 'category_id');
    }

    public function sales()
    {
        return $this->hasMany(sales::class, 'product_id');
    }

    public function installments()
    {
        return $this->hasMany(installments::class, 'product_id');
    }

    public function invoices()
    {
        return $this->hasMany(invoice::class, 'product_id');
    }
}




