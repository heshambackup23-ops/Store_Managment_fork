<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\InstallmentController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\SupplierController;
use App\Http\Controllers\Api\UserController;
use App\Http\Middleware\EnsureUserIsActive;
use App\Http\Requests\Api\CreateCustomerRequest;
use App\Http\Requests\Api\CreateCategoryRequest;
use App\Http\Requests\Api\UpdateCategoryRequest;
use App\Http\Requests\Api\UpdateCustomerRequest;
use Illuminate\Support\Facades\Route;

Route::get('/user', [UserController::class, 'legacy'])
	->middleware(['auth:sanctum', EnsureUserIsActive::class]);

Route::prefix('v1')->name('api.v1.')->group(function (): void {
	Route::post('/auth/token', [AuthController::class, 'store'])
		->middleware('throttle:login')
		->name('auth.token');

	Route::middleware(['auth:sanctum', EnsureUserIsActive::class])->group(function (): void {
		Route::get('/me', [UserController::class, 'show'])
			->middleware('abilities:api:me')
			->name('me');
		Route::get('/products', [ProductController::class, 'index'])
			->middleware(['abilities:page.products.view', 'can:view-products'])
			->name('products.index');
		Route::get('/products/{product}', [ProductController::class, 'show'])
			->whereNumber('product')
			->middleware(['abilities:page.products.view', 'can:view-products'])
			->name('products.show');
		Route::get('/categories', [CategoryController::class, 'index'])
			->middleware(['abilities:page.categories.view', 'can:view-category'])
			->name('categories.index');
		Route::get('/categories/{category}', [CategoryController::class, 'show'])
			->whereNumber('category')
			->middleware(['abilities:page.categories.view', 'can:view-category'])
			->name('categories.show');
		Route::post('/categories', [CategoryController::class, 'store'])
			->middleware(['abilities:page.categories.manage', 'can:create-category'])
			->name('categories.store');
		Route::put('/categories/{category}', [CategoryController::class, 'update'])
			->whereNumber('category')
			->middleware(['abilities:page.categories.manage', 'can:update-category,category'])
			->name('categories.update');
		Route::delete('/categories/{category}', [CategoryController::class, 'destroy'])
			->whereNumber('category')
			->middleware(['abilities:page.categories.manage', 'can:delete-category,category'])
			->name('categories.destroy');
		Route::get('/customers', [CustomerController::class, 'index'])
			->middleware(['abilities:page.customers.view', 'can:view-customers'])
			->name('customers.index');
		Route::get('/customers/{customer}', [CustomerController::class, 'show'])
			->whereNumber('customer')
			->middleware(['abilities:page.customers.view', 'can:view-customers'])
			->name('customers.show');
		Route::post('/customers', [CustomerController::class, 'store'])
			->middleware(['abilities:page.customers.manage', 'can:create-customers'])
			->name('customers.store');
		Route::put('/customers/{customer}', [CustomerController::class, 'update'])
			->whereNumber('customer')
			->middleware(['abilities:page.customers.manage', 'can:update-customers,customer'])
			->name('customers.update');
		Route::delete('/customers/{customer}', [CustomerController::class, 'destroy'])
			->whereNumber('customer')
			->middleware(['abilities:page.customers.manage', 'can:delete-customers,customer'])
			->name('customers.destroy');
		Route::get('/invoices', [InvoiceController::class, 'index'])
			->middleware(['abilities:page.invoices.view', 'can:view-invoice'])
			->name('invoices.index');
		Route::get('/invoices/{invoice}', [InvoiceController::class, 'show'])
			->whereNumber('invoice')
			->middleware(['abilities:page.invoices.view', 'can:view-invoice'])
			->name('invoices.show');
		Route::get('/installments', [InstallmentController::class, 'index'])
			->middleware(['abilities:page.installments.view', 'can:view-installments'])
			->name('installments.index');
		Route::get('/installments/{installment}', [InstallmentController::class, 'show'])
			->whereNumber('installment')
			->middleware(['abilities:page.installments.view', 'can:view-installments'])
			->name('installments.show');
		Route::get('/suppliers', [SupplierController::class, 'index'])
			->middleware(['abilities:page.suppliers.view', 'can:page.suppliers.view'])
			->name('suppliers.index');
		Route::get('/suppliers/{supplier}', [SupplierController::class, 'show'])
			->whereNumber('supplier')
			->middleware(['abilities:page.suppliers.view', 'can:page.suppliers.view'])
			->name('suppliers.show');
		Route::post('/invoices', [InvoiceController::class, 'store'])
			->middleware(['abilities:page.invoices.manage', 'can:create-invoice'])
			->name('invoices.store');
		Route::delete('/auth/token', [AuthController::class, 'destroy'])
			->name('auth.token.revoke');
	});
});
