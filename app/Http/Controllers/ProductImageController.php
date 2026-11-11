<?php

namespace App\Http\Controllers;

use App\Models\products;
use App\Services\PictureStorageService;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class ProductImageController extends Controller
{
    public function __invoke(Request $request, products $product, PictureStorageService $pictures): Response
    {
        return $pictures->productResponse(
            $product->image,
            'products',
            $request->boolean('thumbnail', true),
        );
    }
}
