<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\CashierController;
use App\Http\Controllers\HomeController;
use App\Http\Controllers\SettingsController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\BackupController;
use App\Http\Controllers\CustomersController;
use App\Http\Controllers\SalesController;
use App\Http\Controllers\CategoryController;
use App\Http\Controllers\ProductsController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\InstallmentOperationsController;
use App\Http\Controllers\PersonalDebtOperationsController;
use App\Http\Controllers\InvoiceOperationsController;
use App\Http\Controllers\StaffController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\MaintenanceController;
use App\Http\Controllers\AppNotificationController;
use App\Http\Controllers\SupplierController;
use App\Http\Controllers\ProductImageController;

Route::get('/', [HomeController::class, 'index'])->middleware(['auth:sanctum', 'page.access'])->name('home');

Route::get('/login', [AuthController::class, 'showLogin'])->name('login');
Route::get('/showLogin', [AuthController::class, 'showLogin'])->name('showLogin');
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum')->name('logout');

// Product pictures are public catalog assets and must also load in the native app.
Route::get('/media/products/{product}/image', ProductImageController::class)
    ->whereNumber('product')
    ->name('media.products.image');

Route::middleware(['auth:sanctum', 'page.access'])->group(function () {

    Route::resource('/users', StaffController::class);

    Route::get('/installments/products/search', [InstallmentOperationsController::class, 'searchProducts'])
        ->name('installments.products.search');
    Route::resource('/installments', InstallmentOperationsController::class)->except(['store', 'update', 'destroy']);
    Route::put('/installments/{installment}', [InstallmentOperationsController::class, 'update'])->can('update-installments')
    ->name('installments.update');
    Route::get('/installments/{id}/pay', [InstallmentOperationsController::class, 'showPay'])->can('update-installments')
    ->name('installments.showPay');
    Route::put('/installments/{installment}/pay', [InstallmentOperationsController::class, 'pay'])->can('update-installments')
    ->name('installments.pay');
    Route::put('/installments/{installment}/status', [InstallmentOperationsController::class, 'changeStatus'])->can('update-installments')
        ->name('installments.status');
    Route::post('/installments', [InstallmentOperationsController::class, 'store'])->can('create-installments')
    ->name('installments.store');
    Route::delete('/installments/{installment}', [InstallmentOperationsController::class, 'destroy'])->can('delete-installments')
    ->name('installments.destroy');
    Route::get('/personal-debts/create', [PersonalDebtOperationsController::class, 'create'])->can('create-installments')
        ->name('personal-debts.create');
    Route::post('/personal-debts', [PersonalDebtOperationsController::class, 'store'])->can('create-installments')
        ->name('personal-debts.store');
    Route::get('/personal-debts/{personalDebt}/edit', [PersonalDebtOperationsController::class, 'edit'])->can('update-installments')
        ->name('personal-debts.edit');
    Route::put('/personal-debts/{personalDebt}', [PersonalDebtOperationsController::class, 'update'])->can('update-installments')
        ->name('personal-debts.update');
    Route::get('/personal-debts/{personalDebt}/pay', [PersonalDebtOperationsController::class, 'showPay'])->can('update-installments')
        ->name('personal-debts.showPay');
    Route::put('/personal-debts/{personalDebt}/pay', [PersonalDebtOperationsController::class, 'pay'])->can('update-installments')
        ->name('personal-debts.pay');
    Route::delete('/personal-debts/{personalDebt}', [PersonalDebtOperationsController::class, 'destroy'])->can('delete-installments')
        ->name('personal-debts.destroy');
    Route::get('/settings', [SettingsController::class, 'index'])->name('settings');
    Route::resource('/customers', CustomersController::class)->except(['store', 'update', 'destroy']);
        Route::post('/customers', [CustomersController::class, 'store'])->can('create-customers')
    ->name('customers.store');
        Route::put('/customers/{customer}', [CustomersController::class, 'update'])->can('update-customers')
    ->name('customers.update');
        Route::delete('/customers/{customer}', [CustomersController::class, 'destroy'])->can('delete-customers')
    ->name('customers.destroy');

    Route::resource('/sales', SalesController::class);
    Route::resource('/categories', CategoryController::class)->except(['store', 'update', 'destroy']);
        Route::post('/categories', [CategoryController::class, 'store'])->can('create-category')
    ->name('categories.store');
        Route::put('/categories/{category}', [CategoryController::class, 'update'])->can('update-category')
    ->name('categories.update');
        Route::delete('/categories/{category}', [CategoryController::class, 'destroy'])->can('delete-category')
    ->name('categories.destroy');

    Route::resource('/products', ProductsController::class)->except(['store', 'update', 'destroy']);
        Route::post('/products', [ProductsController::class, 'store'])->can('create-products')
    ->name('products.store');
        Route::put('/products/{product}', [ProductsController::class, 'update'])->can('update-products')
    ->name('products.update');
        Route::delete('/products/{product}', [ProductsController::class, 'destroy'])->can('delete-products')
    ->name('products.destroy');
        Route::get('/products/{product}/print-label', [ProductsController::class, 'printLabel'])->name('products.printLabel');

    Route::resource('/invoices', InvoiceOperationsController::class)->except(['store', 'update', 'destroy']);
        Route::post('/invoices', [InvoiceOperationsController::class, 'store'])->can('create-invoice')
    ->name('invoices.store');
        Route::put('/invoices/{invoice}', [InvoiceOperationsController::class, 'update'])->can('update-invoice')
    ->name('invoices.update');
        Route::delete('/invoices/{invoice}', [InvoiceOperationsController::class, 'destroy'])->can('delete-invoice')
    ->name('invoices.destroy');
        Route::post('/invoices/{invoice}/refund', [InvoiceOperationsController::class, 'refund'])->can('refund-invoice', 'invoice')
    ->name('invoices.refund');
        Route::get('/invoices/{invoice}/print', [InvoiceOperationsController::class, 'print'])->name('invoices.print');

    Route::get('/profile', [ProfileController::class, 'index'])->name('profile.index');
    Route::get('/profile/{profile}/edit', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::put('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::put('/profile/users/{user}/role', [RoleController::class, 'updateLegacyAssignment'])
        ->middleware('superadmin')->name('profile.users.role.update');
        Route::get('/backup', [BackupController::class, 'export'])->name('backup.export');
        Route::post('/backup/import', [BackupController::class, 'webImport'])->name('backup.import');
        Route::get('/notifications', [AppNotificationController::class, 'list'])->name('notifications.list');
        Route::post('/notifications/mark-all-read', [AppNotificationController::class, 'markAllRead'])->name('notifications.markAllRead');
        Route::post('/notifications/{id}/mark-read', [AppNotificationController::class, 'markRead'])->name('notifications.markRead');
        Route::get('/admin/notifications', [AppNotificationController::class, 'index'])->name('admin.notifications.index');
        Route::get('/admin/notifications/create', [AppNotificationController::class, 'create'])->name('admin.notifications.create');
        Route::post('/admin/notifications', [AppNotificationController::class, 'store'])->name('admin.notifications.store');
        Route::delete('/admin/notifications/{id}', [AppNotificationController::class, 'destroy'])->name('admin.notifications.destroy');

    Route::resource('/maintenance', MaintenanceController::class);
    Route::get('/maintenance/{maintenance}/showRepaired', [MaintenanceController::class, 'showRepaired'])->name('maintenance.showRepaired');
    Route::put('/maintenance/{maintenance}/repaired', [MaintenanceController::class, 'repaired'])->name('maintenance.repaired');

    Route::resource('/suppliers', SupplierController::class);
    Route::post('/suppliers/{supplier}/purchases', [SupplierController::class, 'storePurchase'])
        ->name('suppliers.purchases.store');
    Route::post('/suppliers/{supplier}/payments', [SupplierController::class, 'storePayment'])
        ->name('suppliers.payments.store');

    Route::middleware('superadmin')->prefix('roles')->name('roles.')->group(function (): void {
        Route::get('/', [RoleController::class, 'index'])->name('index');
        Route::get('/create', [RoleController::class, 'create'])->name('create');
        Route::post('/', [RoleController::class, 'store'])->name('store');
        Route::get('/{role}/edit', [RoleController::class, 'edit'])->name('edit');
        Route::put('/{role}', [RoleController::class, 'update'])->name('update');
        Route::delete('/{role}', [RoleController::class, 'destroy'])->name('destroy');
        Route::post('/users/{user}/assign', [RoleController::class, 'assign'])->name('users.assign');
    });

});

require __DIR__.'/cashier.php';
require __DIR__.'/wallets.php';
require __DIR__.'/damaged.php';
