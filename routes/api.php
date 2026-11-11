<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\CustomerController;
use App\Http\Controllers\Api\InstallmentController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\SalesController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\MaintenanceController;
use App\Http\Controllers\Api\SupplierController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\WalletController;
use App\Http\Controllers\Api\WalletCashierController;
use App\Http\Controllers\Api\CashierController;
use App\Http\Controllers\Api\ProfileController;
use App\Http\Controllers\Api\DamagedItemController;
use App\Http\Controllers\Api\PersonalDebtController;
use App\Http\Controllers\BackupController;
use App\Http\Middleware\EnsureUserIsActive;
use App\Http\Requests\Api\CreateCustomerRequest;
use App\Http\Requests\Api\CreateCategoryRequest;
use App\Http\Requests\Api\UpdateCategoryRequest;
use App\Http\Requests\Api\UpdateCustomerRequest;
use App\Http\Requests\Api\CreateSupplierRequest;
use App\Http\Requests\Api\UpdateSupplierRequest;
use App\Http\Requests\Api\DeleteSupplierRequest;
use App\Http\Requests\Api\CreateInstallmentRequest;
use App\Http\Requests\Api\CreateMaintenanceRequest;
use App\Http\Requests\Api\UpdateMaintenanceRequest;
use App\Http\Requests\Api\CreateWalletTransactionRequest;
use App\Http\Requests\Api\SettleWalletTransactionRequest;
use App\Http\Requests\Api\ReverseWalletTransactionRequest;
use App\Http\Requests\Api\UpdateInstallmentRequest;
use App\Http\Requests\Api\PayInstallmentRequest;
use App\Http\Requests\Api\DeleteInstallmentRequest;
use App\Http\Requests\Api\PayInvoiceRequest;
use App\Http\Requests\Api\CashierCheckoutRequest;
use App\Http\Requests\Api\UpdateProductRequest;
use App\Http\Requests\Api\UpdateProductImageRequest;
use App\Http\Requests\Api\DeleteProductRequest;
use App\Http\Requests\Api\UpdateProfileRequest;
use App\Http\Requests\Api\RecordDamagedItemRequest;
use App\Http\Requests\Api\VoidDamagedItemRequest;
use App\Http\Requests\Api\CreatePersonalDebtRequest;
use App\Http\Requests\Api\UpdatePersonalDebtRequest;
use App\Http\Requests\Api\DeletePersonalDebtRequest;
use App\Http\Requests\Api\PayPersonalDebtRequest;
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
		Route::get('/profile', [ProfileController::class, 'show'])
			->middleware('abilities:api:me')
			->name('profile.show');
		Route::get('/backup', [BackupController::class, 'apiExport'])
			->middleware(['abilities:page.backup.manage', 'can:page.backup.manage'])
			->name('backup.export');
		Route::post('/backup/import', [BackupController::class, 'apiImport'])
			->middleware(['abilities:page.backup.manage', 'can:page.backup.manage', 'throttle:api'])
			->name('backup.import');
		Route::get('/damaged/products', [DamagedItemController::class, 'products'])
			->middleware(['abilities:page.damaged.view', 'can:page.damaged.view'])
			->name('damaged.products');
		Route::get('/damaged', [DamagedItemController::class, 'index'])
			->middleware(['abilities:page.damaged.view', 'can:page.damaged.view'])
			->name('damaged.index');
		Route::post('/damaged', [DamagedItemController::class, 'store'])
			->middleware(['abilities:page.damaged.manage', 'can:page.damaged.manage'])
			->name('damaged.store');
		Route::get('/damaged/{item}', [DamagedItemController::class, 'show'])
			->whereNumber('item')
			->middleware(['abilities:page.damaged.view', 'can:page.damaged.view'])
			->name('damaged.show');
		Route::put('/damaged/{item}', [DamagedItemController::class, 'update'])
			->whereNumber('item')
			->middleware(['abilities:page.damaged.manage', 'can:page.damaged.manage'])
			->name('damaged.update');
		Route::post('/damaged/{item}/void', [DamagedItemController::class, 'void'])
			->whereNumber('item')
			->middleware(['abilities:page.damaged.manage', 'can:page.damaged.manage'])
			->name('damaged.void');
		Route::put('/profile', [ProfileController::class, 'update'])
			->middleware('abilities:api:me')
			->name('profile.update');
		Route::get('/products', [ProductController::class, 'index'])
			->middleware(['abilities:page.products.view', 'can:view-products'])
			->name('products.index');
		Route::post('/products', [ProductController::class, 'store'])
			->middleware(['abilities:page.products.manage', 'can:create-products'])
			->name('products.store');
		Route::put('/products/{product}', [ProductController::class, 'update'])
			->whereNumber('product')
			->middleware(['abilities:page.products.manage', 'can:update-products,product'])
			->name('products.update');
		Route::post('/products/{product}/image', [ProductController::class, 'updateImage'])
			->whereNumber('product')
			->middleware(['abilities:page.products.manage', 'can:update-products,product'])
			->name('products.image.update');
		Route::delete('/products/{product}', [ProductController::class, 'destroy'])
			->whereNumber('product')
			->middleware(['abilities:page.products.manage', 'can:delete-products,product'])
			->name('products.destroy');
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
		Route::get('/invoices/{invoice}/pdf', [InvoiceController::class, 'pdf'])
			->whereNumber('invoice')
			->middleware(['abilities:page.invoices.view', 'can:view-invoice'])
			->name('invoices.pdf');
		Route::get('/cashier/products', [CashierController::class, 'products'])
			->middleware(['abilities:page.invoices.manage', 'can:create-invoice'])
			->name('cashier.products');
		Route::post('/cashier/checkout', [CashierController::class, 'checkout'])
			->middleware(['abilities:page.invoices.manage', 'can:create-invoice'])
			->name('cashier.checkout');
		Route::get('/invoices/{invoice}', [InvoiceController::class, 'show'])
			->whereNumber('invoice')
			->middleware(['abilities:page.invoices.view', 'can:view-invoice'])
			->name('invoices.show');
		Route::put('/invoices/{invoice}', [InvoiceController::class, 'update'])
			->whereNumber('invoice')
			->middleware(['abilities:page.invoices.manage', 'can:update-invoice,invoice'])
			->name('invoices.update');
		Route::post('/invoices/{invoice}/pay', [InvoiceController::class, 'pay'])
			->whereNumber('invoice')
			->middleware(['abilities:page.invoices.manage', 'can:create-invoice'])
			->name('invoices.pay');
		Route::post('/invoices/{invoice}/refund', [InvoiceController::class, 'refund'])
			->whereNumber('invoice')
			->middleware(['abilities:page.invoices.manage', 'can:update-invoice,invoice'])
			->name('invoices.refund');
		Route::get('/installments', [InstallmentController::class, 'index'])
			->middleware(['abilities:page.installments.view', 'can:view-installments'])
			->name('installments.index');
		Route::get('/personal-debts', [PersonalDebtController::class, 'index'])
			->middleware(['abilities:page.installments.view', 'can:view-installments'])
			->name('personal-debts.index');
		Route::post('/personal-debts', [PersonalDebtController::class, 'store'])
			->middleware(['abilities:page.installments.manage', 'can:create-installments'])
			->name('personal-debts.store');
		Route::get('/personal-debts/{debt}', [PersonalDebtController::class, 'show'])
			->whereNumber('debt')
			->middleware(['abilities:page.installments.view', 'can:view-installments'])
			->name('personal-debts.show');
		Route::put('/personal-debts/{debt}', [PersonalDebtController::class, 'update'])
			->whereNumber('debt')
			->middleware(['abilities:page.installments.manage', 'can:update-installments'])
			->name('personal-debts.update');
		Route::delete('/personal-debts/{debt}', [PersonalDebtController::class, 'destroy'])
			->whereNumber('debt')
			->middleware(['abilities:page.installments.manage', 'can:delete-installments'])
			->name('personal-debts.destroy');
		Route::post('/personal-debts/{debt}/pay', [PersonalDebtController::class, 'pay'])
			->whereNumber('debt')
			->middleware(['abilities:page.installments.manage', 'can:update-installments'])
			->name('personal-debts.pay');
		Route::get('/installments/{installment}', [InstallmentController::class, 'show'])
			->whereNumber('installment')
			->middleware(['abilities:page.installments.view', 'can:view-installments'])
			->name('installments.show');
		Route::post('/installments', [InstallmentController::class, 'store'])
			->middleware(['abilities:page.installments.manage', 'can:create-installments'])
			->name('installments.store');
		Route::put('/installments/{installment}', [InstallmentController::class, 'update'])
			->whereNumber('installment')
			->middleware(['abilities:page.installments.manage', 'can:update-installments,installment'])
			->name('installments.update');
		Route::post('/installments/{installment}/pay', [InstallmentController::class, 'pay'])
			->whereNumber('installment')
			->middleware(['abilities:page.installments.manage', 'can:update-installments,installment'])
			->name('installments.pay');
		Route::post('/installments/{installment}/status', [InstallmentController::class, 'changeStatus'])
			->whereNumber('installment')
			->middleware(['abilities:page.installments.manage', 'can:update-installments,installment'])
			->name('installments.status');
		Route::delete('/installments/{installment}', [InstallmentController::class, 'destroy'])
			->whereNumber('installment')
			->middleware(['abilities:page.installments.manage', 'can:delete-installments,installment'])
			->name('installments.destroy');
		Route::get('/suppliers', [SupplierController::class, 'index'])
			->middleware(['abilities:page.suppliers.view', 'can:page.suppliers.view'])
			->name('suppliers.index');
		Route::get('/suppliers/{supplier}', [SupplierController::class, 'show'])
			->whereNumber('supplier')
			->middleware(['abilities:page.suppliers.view', 'can:page.suppliers.view'])
			->name('suppliers.show');
		Route::post('/suppliers', [SupplierController::class, 'store'])
			->middleware(['abilities:page.suppliers.manage', 'can:page.suppliers.manage'])
			->name('suppliers.store');
		Route::put('/suppliers/{supplier}', [SupplierController::class, 'update'])
			->whereNumber('supplier')
			->middleware(['abilities:page.suppliers.manage', 'can:page.suppliers.manage'])
			->name('suppliers.update');
		Route::delete('/suppliers/{supplier}', [SupplierController::class, 'destroy'])
			->whereNumber('supplier')
			->middleware(['abilities:page.suppliers.manage', 'can:page.suppliers.manage'])
			->name('suppliers.destroy');
		Route::post('/invoices', [InvoiceController::class, 'store'])
			->middleware(['abilities:page.invoices.manage', 'can:create-invoice'])
			->name('invoices.store');
		Route::get('/wallets', [WalletController::class, 'index'])
			->middleware(['abilities:page.wallets.view', 'can:page.wallets.view'])
			->name('wallets.index');
		Route::post('/wallets', [WalletController::class, 'store'])
			->middleware(['abilities:page.wallets.manage', 'can:page.wallets.manage'])
			->name('wallets.store');
		Route::post('/wallets/{wallet}/toggle', [WalletController::class, 'toggle'])
			->whereNumber('wallet')
			->middleware(['abilities:page.wallets.manage', 'can:page.wallets.manage'])
			->name('wallets.toggle');
		Route::post('/wallets/{wallet}/adjust', [WalletController::class, 'adjust'])
			->whereNumber('wallet')
			->middleware(['abilities:page.wallets.manage', 'can:page.wallets.manage'])
			->name('wallets.adjust');
		Route::get('/sales', [SalesController::class, 'index'])
			->middleware(['abilities:page.sales.view', 'can:page.sales.view'])
			->name('sales.index');
		Route::get('/notifications', [NotificationController::class, 'index'])
			->middleware(['abilities:page.notifications.view', 'can:page.notifications.view'])
			->name('notifications.index');
		Route::get('/maintenance', [MaintenanceController::class, 'index'])
			->middleware(['abilities:page.maintenance.view', 'can:page.maintenance.view'])
			->name('maintenance.index');
		Route::get('/maintenance/{maintenance}', [MaintenanceController::class, 'show'])
			->whereNumber('maintenance')
			->middleware(['abilities:page.maintenance.view', 'can:page.maintenance.view'])
			->name('maintenance.show');
		Route::post('/maintenance', [MaintenanceController::class, 'store'])
			->middleware(['abilities:page.maintenance.manage', 'can:page.maintenance.manage'])
			->name('maintenance.store');
		Route::put('/maintenance/{maintenance}', [MaintenanceController::class, 'update'])
			->whereNumber('maintenance')
			->middleware(['abilities:page.maintenance.manage', 'can:page.maintenance.manage'])
			->name('maintenance.update');
		Route::delete('/maintenance/{maintenance}', [MaintenanceController::class, 'destroy'])
			->whereNumber('maintenance')
			->middleware(['abilities:page.maintenance.manage', 'can:page.maintenance.manage'])
			->name('maintenance.destroy');
		Route::get('/wallet-cashier', [WalletCashierController::class, 'index'])
			->middleware(['abilities:page.wallet_cashier.view', 'can:page.wallet_cashier.view'])
			->name('wallet-cashier.index');
		Route::post('/wallet-cashier', [WalletCashierController::class, 'store'])
			->middleware(['abilities:page.wallet_cashier.manage', 'can:page.wallet_cashier.manage'])
			->name('wallet-cashier.store');
		Route::post('/wallet-cashier/{transaction}/settle', [WalletCashierController::class, 'settle'])
			->middleware(['abilities:page.wallet_cashier.manage', 'can:page.wallet_cashier.manage'])
			->name('wallet-cashier.settle');
		Route::post('/wallet-cashier/{transaction}/reverse', [WalletCashierController::class, 'reverse'])
			->middleware(['abilities:page.wallets.manage', 'can:page.wallets.manage'])
			->name('wallet-cashier.reverse');
		Route::post('/notifications/read-all', [NotificationController::class, 'readAll'])
			->middleware(['abilities:page.notifications.view', 'can:page.notifications.view'])
			->name('notifications.read-all');
		Route::post('/notifications/{notification}/read', [NotificationController::class, 'read'])
			->whereNumber('notification')
			->middleware(['abilities:page.notifications.view', 'can:page.notifications.view'])
			->name('notifications.read');
		Route::delete('/auth/token', [AuthController::class, 'destroy'])
			->name('auth.token.revoke');
	});
});
