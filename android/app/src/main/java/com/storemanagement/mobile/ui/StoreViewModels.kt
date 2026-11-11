package com.storemanagement.mobile.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.storemanagement.mobile.core.network.ApiFailure
import com.storemanagement.mobile.core.database.CachedCategory
import com.storemanagement.mobile.core.database.CachedProduct
import com.storemanagement.mobile.core.network.ApiPage
import com.storemanagement.mobile.core.network.ApiResult
import com.storemanagement.mobile.core.network.CategoryInputDto
import com.storemanagement.mobile.core.network.CategoryDto
import com.storemanagement.mobile.core.network.CustomerDto
import com.storemanagement.mobile.core.network.CustomerInputDto
import com.storemanagement.mobile.core.network.InvoiceDto
import com.storemanagement.mobile.core.network.InvoiceInputDto
import com.storemanagement.mobile.core.network.InstallmentDto
import com.storemanagement.mobile.core.network.InstallmentInputDto
import com.storemanagement.mobile.core.network.InstallmentStatusInputDto
import com.storemanagement.mobile.core.network.PersonalDebtDto
import com.storemanagement.mobile.core.network.PersonalDebtInputDto
import com.storemanagement.mobile.core.network.ProductDto
import com.storemanagement.mobile.core.network.ProductInputDto
import com.storemanagement.mobile.core.network.SupplierDto
import com.storemanagement.mobile.core.network.SupplierInputDto
import com.storemanagement.mobile.core.network.SoldProductDto
import com.storemanagement.mobile.core.network.NotificationDto
import com.storemanagement.mobile.core.network.MaintenanceDto
import com.storemanagement.mobile.core.network.MaintenanceInputDto
import com.storemanagement.mobile.core.network.CashierSearchResponseDto
import com.storemanagement.mobile.core.network.CashierCheckoutInputDto
import com.storemanagement.mobile.core.network.CashierCheckoutResponseDto
import com.storemanagement.mobile.core.network.CashierProductDto
import com.storemanagement.mobile.core.network.PayAmountInputDto
import com.storemanagement.mobile.core.network.ProfileDto
import com.storemanagement.mobile.core.network.ProfileInputDto
import com.storemanagement.mobile.core.network.DamagedItemDto
import com.storemanagement.mobile.core.network.DamagedProductDto
import com.storemanagement.mobile.core.network.DamagedItemInputDto
import com.storemanagement.mobile.core.network.VoidDamagedItemInputDto
import com.storemanagement.mobile.core.network.UserDto
import com.storemanagement.mobile.core.network.WalletOverviewDto
import com.storemanagement.mobile.core.network.WalletInputDto
import com.storemanagement.mobile.core.network.WalletAdjustmentInputDto
import com.storemanagement.mobile.core.network.WalletCashierDto
import com.storemanagement.mobile.core.network.WalletCashierInputDto
import com.storemanagement.mobile.core.network.SettleWalletTransactionInputDto
import com.storemanagement.mobile.core.network.ReverseWalletTransactionInputDto
import com.storemanagement.mobile.data.SessionRepository
import com.storemanagement.mobile.data.StoreRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.util.UUID
import android.content.ContentResolver
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import javax.inject.Inject

data class SessionUiState(
    val isRestoring: Boolean = false,
    val isSubmitting: Boolean = false,
    val user: UserDto? = null,
    val error: String? = null,
)

data class InvoicePdfUiState(
    val isDownloading: Boolean = false,
    val message: String? = null,
    val isError: Boolean = false,
)

@HiltViewModel
class SessionViewModel @Inject constructor(
    private val sessionRepository: SessionRepository,
) : ViewModel() {
    private val mutableState = MutableStateFlow(SessionUiState(isRestoring = true))
    val state = mutableState

    init {
        restoreSession()
    }

    fun restoreSession() {
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(isRestoring = true, error = null)
            when (val result = sessionRepository.restore()) {
                is ApiResult.Success -> mutableState.value = SessionUiState(isRestoring = false, user = result.value)
                is ApiResult.Failure -> mutableState.value = SessionUiState(isRestoring = false, error = result.error.message)
            }
        }
    }

    fun login(username: String, password: String) {
        if (username.isBlank() || password.isBlank()) {
            mutableState.value = mutableState.value.copy(error = "أدخل اسم المستخدم وكلمة المرور.")
            return
        }

        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(isSubmitting = true, error = null)
            when (val result = sessionRepository.login(username.trim(), password, "store-management-android")) {
                is ApiResult.Success -> mutableState.value = SessionUiState(isRestoring = false, user = result.value)
                is ApiResult.Failure -> mutableState.value = SessionUiState(isRestoring = false, error = result.error.message)
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            mutableState.value = mutableState.value.copy(isSubmitting = true, error = null)
            when (val result = sessionRepository.logout()) {
                is ApiResult.Success -> mutableState.value = SessionUiState(isRestoring = false, isSubmitting = false)
                is ApiResult.Failure -> mutableState.value = SessionUiState(isRestoring = false, error = result.error.message)
            }
        }
    }

    fun expireSession() {
        viewModelScope.launch {
            sessionRepository.clearLocalSession()
            mutableState.value = SessionUiState(isRestoring = false, error = ApiFailure.Unauthorized.message)
        }
    }
}

data class RemotePage<T>(
    val items: List<T> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val currentPage: Int = 1,
    val lastPage: Int = 1,
    val total: Int = 0,
)

data class ProductDetailUiState(
    val product: ProductDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

data class InvoiceDetailUiState(
    val invoice: InvoiceDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

data class SupplierDetailUiState(
    val supplier: SupplierDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

data class CategoryDetailUiState(
    val category: CategoryDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

data class CustomerDetailUiState(
    val customer: CustomerDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

data class InstallmentDetailUiState(
    val installment: InstallmentDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

data class WalletOverviewUiState(
    val overview: WalletOverviewDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

data class WalletCashierUiState(
    val data: WalletCashierDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

data class CashierPosUiState(
    val products: List<CashierProductDto> = emptyList(),
    val exactMatch: Boolean = false,
    val isLoading: Boolean = false,
    val error: String? = null,
)

data class ProfileUiState(
    val profile: ProfileDto? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

data class DamagedProductsUiState(
    val products: List<DamagedProductDto> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
)

sealed interface StoreEvent {
    data class Saved(val message: String) : StoreEvent
    data class Failed(val message: String) : StoreEvent
    data object SessionExpired : StoreEvent
}

@HiltViewModel
class StoreViewModel @Inject constructor(
    private val storeRepository: StoreRepository,
    private val sessionRepository: SessionRepository,
) : ViewModel() {
    private val mutableInvoicePdfState = MutableStateFlow(InvoicePdfUiState())
    val invoicePdfState = mutableInvoicePdfState
    private val mutableBackupMessage = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val backupMessage = mutableBackupMessage.asSharedFlow()
    private val mutableBackupBusy = MutableStateFlow(false)
    val backupBusy = mutableBackupBusy

    fun downloadBackup(pages: List<String>, uri: Uri, resolver: ContentResolver) {
        viewModelScope.launch {
            if (mutableBackupBusy.value) return@launch
            mutableBackupBusy.value = true
            try {
                withContext(Dispatchers.IO) {
                    val body = storeRepository.downloadBackup(pages)
                    resolver.openOutputStream(uri)?.use { output -> body.byteStream().use { it.copyTo(output) } }
                        ?: error("Unable to open destination")
                    body.close()
                }
                mutableBackupMessage.emit("تم حفظ النسخة الاحتياطية على الجهاز")
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { mutableBackupMessage.emit("تعذر تنزيل النسخة الاحتياطية") }
            finally { mutableBackupBusy.value = false }
        }
    }

    fun importBackup(pages: List<String>, uri: Uri, resolver: ContentResolver, cacheDir: File) {
        viewModelScope.launch {
            if (mutableBackupBusy.value) return@launch
            mutableBackupBusy.value = true
            var temp: File? = null
            try {
                withContext(Dispatchers.IO) {
                    temp = File.createTempFile("store-backup-", ".zip", cacheDir)
                    resolver.openInputStream(uri)?.use { input -> temp!!.outputStream().use(input::copyTo) }
                        ?: error("Unable to read selected file")
                    storeRepository.importBackup(pages, temp!!)
                }
                mutableBackupMessage.emit("تم استيراد بيانات النسخة بنجاح")
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { mutableBackupMessage.emit("تعذر استيراد الملف. تحقق من نوعه والصفحات المحددة") }
            finally { temp?.delete(); mutableBackupBusy.value = false }
        }
    }

    val products = storeRepository.observeProducts().stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        emptyList(),
    )
    val productCacheTime = storeRepository.observeProductCacheTime().stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        null,
    )
    val categories = storeRepository.observeCategories().stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        emptyList(),
    )

    private val mutableCustomers = MutableStateFlow(RemotePage<CustomerDto>())
    val customers = mutableCustomers
    private val mutableSales = MutableStateFlow(RemotePage<SoldProductDto>())
    val sales = mutableSales
    private val mutableNotifications = MutableStateFlow(RemotePage<NotificationDto>())
    val notifications = mutableNotifications
    private val mutableMaintenances = MutableStateFlow(RemotePage<MaintenanceDto>())
    val maintenances = mutableMaintenances
    private val mutableInvoices = MutableStateFlow(RemotePage<InvoiceDto>())
    val invoices = mutableInvoices
    private val mutableSuppliers = MutableStateFlow(RemotePage<SupplierDto>())
    val suppliers = mutableSuppliers
    private val mutableInstallments = MutableStateFlow(RemotePage<InstallmentDto>())
    val installments = mutableInstallments
    private val mutablePersonalDebts = MutableStateFlow(RemotePage<PersonalDebtDto>())
    val personalDebts = mutablePersonalDebts
    private val mutableWalletOverview = MutableStateFlow(WalletOverviewUiState())
    val walletOverview = mutableWalletOverview
    private val mutableWalletCashier = MutableStateFlow(WalletCashierUiState())
    val walletCashier = mutableWalletCashier
    private val mutableCashierPos = MutableStateFlow(CashierPosUiState())
    val cashierPos = mutableCashierPos
    private val mutableProfile = MutableStateFlow(ProfileUiState())
    val profile = mutableProfile
    private val mutableDamagedItems = MutableStateFlow(RemotePage<DamagedItemDto>())
    val damagedItems = mutableDamagedItems
    private val mutableDamagedProducts = MutableStateFlow(DamagedProductsUiState())
    val damagedProducts = mutableDamagedProducts
    private val mutableProductPage = MutableStateFlow(RemotePage<ProductDto>())
    val productPage = mutableProductPage
    private val mutableProductDetails = MutableStateFlow(ProductDetailUiState())
    val productDetails = mutableProductDetails
    private val mutableInvoiceDetails = MutableStateFlow(InvoiceDetailUiState())
    val invoiceDetails = mutableInvoiceDetails
    private val mutableSupplierDetails = MutableStateFlow(SupplierDetailUiState())
    val supplierDetails = mutableSupplierDetails
    private val mutableCategoryDetails = MutableStateFlow(CategoryDetailUiState())
    val categoryDetails = mutableCategoryDetails
    private val mutableCustomerDetails = MutableStateFlow(CustomerDetailUiState())
    val customerDetails = mutableCustomerDetails
    private val mutableInstallmentDetails = MutableStateFlow(InstallmentDetailUiState())
    val installmentDetails = mutableInstallmentDetails
    private val mutableCategoryPage = MutableStateFlow(RemotePage<CategoryDto>())
    val categoryPage = mutableCategoryPage
    private val mutableProductError = MutableStateFlow<String?>(null)
    val productError = mutableProductError
    private val mutableCategoryError = MutableStateFlow<String?>(null)
    val categoryError = mutableCategoryError
    private val mutableEvents = MutableSharedFlow<StoreEvent>(extraBufferCapacity = 8)
    val events = mutableEvents.asSharedFlow()
    private val mutableIsSaving = MutableStateFlow(false)
    val isSaving = mutableIsSaving
    private var activeWrites = 0

    private var productQuery: String? = null
    private var productCategoryId: Long? = null
    private var productStockFilter: Boolean? = null
    private var categoryQuery: String? = null
    private var customerQuery: String? = null
    private var salesQuery: String? = null
    private var invoiceQuery: String? = null
    private var supplierQuery: String? = null
    private var installmentQuery: String? = null
    private var personalDebtQuery: String? = null
    private var damagedQuery: String? = null
    private var damagedStatus: String? = null
    private var productRequest: Job? = null
    private var productDetailsRequest: Job? = null
    private var invoiceDetailsRequest: Job? = null
    private var supplierDetailsRequest: Job? = null
    private var categoryDetailsRequest: Job? = null
    private var customerDetailsRequest: Job? = null
    private var installmentDetailsRequest: Job? = null
    private var categoryRequest: Job? = null
    private var customerRequest: Job? = null
    private var salesRequest: Job? = null
    private var notificationsRequest: Job? = null
    private var maintenanceQuery: String? = null
    private var maintenanceRequest: Job? = null
    private var cashierPosRequest: Job? = null
    private var damagedRequest: Job? = null
    private var damagedProductsRequest: Job? = null
    private var invoiceRequest: Job? = null
    private var supplierRequest: Job? = null
    private var installmentRequest: Job? = null
    private var personalDebtRequest: Job? = null

    fun refreshProducts(
        query: String? = productQuery,
        page: Int = 1,
        categoryId: Long? = productCategoryId,
        inStock: Boolean? = productStockFilter,
    ) {
        if (page == 1) {
            productQuery = query
            productCategoryId = categoryId
            productStockFilter = inStock
        }
        val requestedQuery = productQuery
        val requestedCategoryId = productCategoryId
        val requestedStockFilter = productStockFilter
        productRequest?.cancel()
        productRequest = viewModelScope.launch {
            mutableProductError.value = null
            mutableProductPage.value = if (page == 1) {
                mutableProductPage.value.copy(isLoading = true, error = null)
            } else {
                mutableProductPage.value.copy(isLoading = true, error = null)
            }
            when (val result = storeRepository.refreshProducts(requestedQuery, page, requestedCategoryId, requestedStockFilter)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    mutableProductPage.value = if (page == 1) loaded else {
                        mutableProductPage.value.appendPage(loaded, ProductDto::id)
                    }
                }
                is ApiResult.Failure -> {
                    mutableProductError.value = result.error.message
                    mutableProductPage.value = mutableProductPage.value.copy(isLoading = false, error = result.error.message)
                    notifySessionExpiry(result.error)
                }
            }
        }
    }

    fun loadMoreProducts() {
        val page = mutableProductPage.value
        if (!page.isLoading && page.currentPage < page.lastPage) refreshProducts(productQuery, page.currentPage + 1)
    }

    fun loadProductDetails(id: Long) {
        productDetailsRequest?.cancel()
        mutableProductDetails.value = ProductDetailUiState(isLoading = true)
        productDetailsRequest = viewModelScope.launch {
            mutableProductDetails.value = when (val result = storeRepository.productDetails(id)) {
                is ApiResult.Success -> ProductDetailUiState(product = result.value)
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    ProductDetailUiState(error = result.error.message)
                }
            }
        }
    }

    suspend fun findProductByBarcode(barcode: String): ApiResult<ProductDto?> {
        val result = storeRepository.findProductByBarcode(barcode)
        if (result is ApiResult.Failure) notifySessionExpiry(result.error)
        return result
    }

    fun clearProductDetails() {
        productDetailsRequest?.cancel()
        mutableProductDetails.value = ProductDetailUiState()
    }

    fun loadInvoiceDetails(id: Long) {
        invoiceDetailsRequest?.cancel()
        mutableInvoiceDetails.value = InvoiceDetailUiState(isLoading = true)
        invoiceDetailsRequest = viewModelScope.launch {
            mutableInvoiceDetails.value = when (val result = storeRepository.invoiceDetails(id)) {
                is ApiResult.Success -> InvoiceDetailUiState(invoice = result.value)
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    InvoiceDetailUiState(error = result.error.message)
                }
            }
        }
    }

    fun clearInvoiceDetails() {
        invoiceDetailsRequest?.cancel()
        mutableInvoiceDetails.value = InvoiceDetailUiState()
    }

    fun refreshCategories(query: String? = categoryQuery, page: Int = 1) {
        if (page == 1) categoryQuery = query
        val requestedQuery = categoryQuery
        categoryRequest?.cancel()
        categoryRequest = viewModelScope.launch {
            mutableCategoryError.value = null
            mutableCategoryPage.value = mutableCategoryPage.value.copy(isLoading = true, error = null)
            when (val result = storeRepository.refreshCategories(requestedQuery, page)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    mutableCategoryPage.value = if (page == 1) loaded else {
                        mutableCategoryPage.value.appendPage(loaded, CategoryDto::id)
                    }
                }
                is ApiResult.Failure -> {
                    mutableCategoryError.value = result.error.message
                    mutableCategoryPage.value = mutableCategoryPage.value.copy(isLoading = false, error = result.error.message)
                    notifySessionExpiry(result.error)
                }
            }
        }
    }

    fun loadMoreCategories() {
        val page = mutableCategoryPage.value
        if (!page.isLoading && page.currentPage < page.lastPage) refreshCategories(categoryQuery, page.currentPage + 1)
    }

    fun refreshCustomers(query: String? = customerQuery, page: Int = 1) {
        if (page == 1) customerQuery = query
        val requestedQuery = customerQuery
        customerRequest?.cancel()
        customerRequest = viewModelScope.launch {
            mutableCustomers.value = if (page == 1) {
                mutableCustomers.value.copy(isLoading = true, error = null)
            } else {
                mutableCustomers.value.copy(isLoading = true, error = null)
            }
            mutableCustomers.value = when (val result = storeRepository.customers(requestedQuery, page)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    if (page == 1) loaded else mutableCustomers.value.appendPage(loaded, CustomerDto::id)
                }
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutableCustomers.value.copy(isLoading = false, error = result.error.message)
                }
            }
        }
    }

    fun loadMoreCustomers() {
        val page = mutableCustomers.value
        if (!page.isLoading && page.currentPage < page.lastPage) refreshCustomers(customerQuery, page.currentPage + 1)
    }

    fun refreshSales(query: String? = salesQuery, page: Int = 1) {
        if (page == 1) salesQuery = query
        val requestedQuery = salesQuery
        salesRequest?.cancel()
        salesRequest = viewModelScope.launch {
            mutableSales.value = if (page == 1) {
                mutableSales.value.copy(isLoading = true, error = null)
            } else {
                mutableSales.value.copy(isLoading = true, error = null)
            }
            mutableSales.value = when (val result = storeRepository.sales(requestedQuery, page)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    if (page == 1) loaded else mutableSales.value.appendPage(loaded, SoldProductDto::id)
                }
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutableSales.value.copy(isLoading = false, error = result.error.message)
                }
            }
        }
    }

    fun loadMoreSales() {
        val page = mutableSales.value
        if (!page.isLoading && page.currentPage < page.lastPage) refreshSales(salesQuery, page.currentPage + 1)
    }

    fun refreshNotifications(page: Int = 1) {
        notificationsRequest?.cancel()
        notificationsRequest = viewModelScope.launch {
            mutableNotifications.value = if (page == 1) {
                mutableNotifications.value.copy(isLoading = true, error = null)
            } else {
                mutableNotifications.value.copy(isLoading = true, error = null)
            }
            mutableNotifications.value = when (val result = storeRepository.notifications(page)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    if (page == 1) loaded else mutableNotifications.value.appendPage(loaded, NotificationDto::id)
                }
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutableNotifications.value.copy(isLoading = false, error = result.error.message)
                }
            }
        }
    }

    fun loadMoreNotifications() {
        val page = mutableNotifications.value
        if (!page.isLoading && page.currentPage < page.lastPage) refreshNotifications(page.currentPage + 1)
    }

    fun markNotificationRead(id: Long) {
        viewModelScope.launch {
            when (val result = storeRepository.markNotificationRead(id)) {
                is ApiResult.Success -> mutableNotifications.value = mutableNotifications.value.copy(
                    items = mutableNotifications.value.items.map { notification ->
                        if (notification.id == id) notification.copy(isRead = true) else notification
                    },
                )
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutableEvents.emit(StoreEvent.Failed(result.error.message))
                }
            }
        }
    }

    fun markAllNotificationsRead() {
        viewModelScope.launch {
            when (val result = storeRepository.markAllNotificationsRead()) {
                is ApiResult.Success -> mutableNotifications.value = mutableNotifications.value.copy(
                    items = mutableNotifications.value.items.map { it.copy(isRead = true) },
                )
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutableEvents.emit(StoreEvent.Failed(result.error.message))
                }
            }
        }
    }

    fun refreshMaintenances(query: String? = maintenanceQuery, page: Int = 1) {
        if (page == 1) maintenanceQuery = query
        val requestedQuery = maintenanceQuery
        maintenanceRequest?.cancel()
        maintenanceRequest = viewModelScope.launch {
            mutableMaintenances.value = if (page == 1) {
                mutableMaintenances.value.copy(isLoading = true, error = null)
            } else {
                mutableMaintenances.value.copy(isLoading = true, error = null)
            }
            mutableMaintenances.value = when (val result = storeRepository.maintenance(requestedQuery, page)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    if (page == 1) loaded else mutableMaintenances.value.appendPage(loaded, MaintenanceDto::id)
                }
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutableMaintenances.value.copy(isLoading = false, error = result.error.message)
                }
            }
        }
    }

    fun refreshWalletCashier() {
        viewModelScope.launch {
            mutableWalletCashier.value = mutableWalletCashier.value.copy(isLoading = true, error = null)
            when (val result = storeRepository.walletCashier()) {
                is ApiResult.Success -> mutableWalletCashier.value = WalletCashierUiState(data = result.value)
                is ApiResult.Failure -> {
                    mutableWalletCashier.value = WalletCashierUiState(error = result.error.message)
                    notifySessionExpiry(result.error)
                }
            }
        }
    }

    fun searchCashierProducts(query: String = "") {
        cashierPosRequest?.cancel()
        cashierPosRequest = viewModelScope.launch {
            mutableCashierPos.value = mutableCashierPos.value.copy(isLoading = true, error = null)
            when (val result = storeRepository.cashierProducts(query.trim().ifBlank { null })) {
                is ApiResult.Success -> mutableCashierPos.value = CashierPosUiState(
                    products = result.value.data,
                    exactMatch = result.value.exact,
                )
                is ApiResult.Failure -> {
                    mutableCashierPos.value = mutableCashierPos.value.copy(isLoading = false, error = result.error.message)
                    notifySessionExpiry(result.error)
                }
            }
        }
    }

    fun checkoutCashier(
        input: CashierCheckoutInputDto,
        key: String,
        onComplete: (CashierCheckoutResponseDto) -> Unit,
    ) {
        viewModelScope.launch {
            activeWrites++
            mutableIsSaving.value = true
            try {
                when (val result = storeRepository.cashierCheckout(key, input)) {
                    is ApiResult.Success -> {
                        mutableEvents.emit(StoreEvent.Saved("تم إتمام البيع."))
                        refreshInvoices(null)
                        refreshProducts(null)
                        onComplete(result.value.data)
                    }
                    is ApiResult.Failure -> {
                        if (result.error == ApiFailure.Unauthorized) mutableEvents.emit(StoreEvent.SessionExpired)
                        else mutableEvents.emit(StoreEvent.Failed(result.error.message))
                    }
                }
            } finally {
                activeWrites--
                mutableIsSaving.value = activeWrites > 0
            }
        }
    }

    fun loadMoreMaintenances() {
        val page = mutableMaintenances.value
        if (!page.isLoading && page.currentPage < page.lastPage) {
            refreshMaintenances(maintenanceQuery, page.currentPage + 1)
        }
    }

    fun refreshInvoices(query: String? = invoiceQuery, page: Int = 1) {
        if (page == 1) invoiceQuery = query
        val requestedQuery = invoiceQuery
        invoiceRequest?.cancel()
        invoiceRequest = viewModelScope.launch {
            mutableInvoices.value = if (page == 1) {
                mutableInvoices.value.copy(isLoading = true, error = null)
            } else {
                mutableInvoices.value.copy(isLoading = true, error = null)
            }
            mutableInvoices.value = when (val result = storeRepository.invoices(requestedQuery, page)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    if (page == 1) loaded else mutableInvoices.value.appendPage(loaded, InvoiceDto::id)
                }
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutableInvoices.value.copy(isLoading = false, error = result.error.message)
                }
            }
        }
    }

    fun loadMoreInvoices() {
        val page = mutableInvoices.value
        if (!page.isLoading && page.currentPage < page.lastPage) refreshInvoices(invoiceQuery, page.currentPage + 1)
    }

    fun refreshSuppliers(query: String? = supplierQuery, page: Int = 1) {
        if (page == 1) supplierQuery = query
        val requestedQuery = supplierQuery
        supplierRequest?.cancel()
        supplierRequest = viewModelScope.launch {
            mutableSuppliers.value = if (page == 1) {
                mutableSuppliers.value.copy(isLoading = true, error = null)
            } else {
                mutableSuppliers.value.copy(isLoading = true, error = null)
            }
            mutableSuppliers.value = when (val result = storeRepository.suppliers(requestedQuery, page)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    if (page == 1) loaded else mutableSuppliers.value.appendPage(loaded, SupplierDto::id)
                }
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutableSuppliers.value.copy(isLoading = false, error = result.error.message)
                }
            }
        }
    }

    fun refreshWalletOverview() {
        viewModelScope.launch {
            mutableWalletOverview.value = mutableWalletOverview.value.copy(isLoading = true, error = null)
            mutableWalletOverview.value = when (val result = storeRepository.walletOverview()) {
                is ApiResult.Success -> WalletOverviewUiState(overview = result.value)
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    WalletOverviewUiState(error = result.error.message)
                }
            }
        }
    }

    fun refreshProfile() {
        viewModelScope.launch {
            mutableProfile.value = mutableProfile.value.copy(isLoading = true, error = null)
            mutableProfile.value = when (val result = storeRepository.profile()) {
                is ApiResult.Success -> ProfileUiState(profile = result.value)
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    ProfileUiState(error = result.error.message)
                }
            }
        }
    }

    fun refreshDamagedItems(query: String? = damagedQuery, status: String? = damagedStatus, page: Int = 1) {
        if (page == 1) {
            damagedQuery = query
            damagedStatus = status
        }
        val requestedQuery = damagedQuery
        val requestedStatus = damagedStatus
        damagedRequest?.cancel()
        damagedRequest = viewModelScope.launch {
            mutableDamagedItems.value = if (page == 1) mutableDamagedItems.value.copy(isLoading = true, error = null)
            else mutableDamagedItems.value.copy(isLoading = true, error = null)
            when (val result = storeRepository.damagedItems(requestedQuery, requestedStatus, page)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    mutableDamagedItems.value = if (page == 1) loaded else mutableDamagedItems.value.appendPage(loaded, DamagedItemDto::id)
                }
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutableDamagedItems.value = mutableDamagedItems.value.copy(isLoading = false, error = result.error.message)
                }
            }
        }
    }

    fun searchDamagedProducts(query: String? = null) {
        damagedProductsRequest?.cancel()
        damagedProductsRequest = viewModelScope.launch {
            mutableDamagedProducts.value = mutableDamagedProducts.value.copy(isLoading = true, error = null)
            mutableDamagedProducts.value = when (val result = storeRepository.damagedProducts(query)) {
                is ApiResult.Success -> DamagedProductsUiState(products = result.value)
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    DamagedProductsUiState(error = result.error.message)
                }
            }
        }
    }

    fun createDamagedItem(input: DamagedItemInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تسجيل الهالك وخصم الكمية من المخزون.") { storeRepository.createDamagedItem(key, input) }) {
                refreshDamagedItems()
                refreshProducts(null)
            }
        }
    }

    fun updateDamagedItem(id: Long, input: DamagedItemInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تعديل سجل الهالك وتحديث المخزون.") { storeRepository.updateDamagedItem(id, key, input) }) {
                refreshDamagedItems()
                refreshProducts(null)
            }
        }
    }

    fun voidDamagedItem(id: Long, input: VoidDamagedItemInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم إلغاء السجل وإرجاع الكمية للمخزون.") { storeRepository.voidDamagedItem(id, key, input) }) {
                refreshDamagedItems()
                refreshProducts(null)
            }
        }
    }

    fun updateProfile(input: ProfileInputDto) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث الحساب.") { storeRepository.updateProfile(input) }) refreshProfile()
        }
    }

    fun createProduct(input: ProductInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تمت إضافة المنتج.") { storeRepository.createProduct(key, input) }) {
                refreshProducts(null)
            }
        }
    }

    fun saveProduct(
        id: Long?, input: ProductInputDto, key: String, imageUri: Uri?,
        resolver: ContentResolver, cacheDir: File,
    ) {
        viewModelScope.launch {
            var imageFile: File? = null
            try {
                if (imageUri != null) imageFile = withContext(Dispatchers.IO) {
                    val file = File.createTempFile("product-image-", ".upload", cacheDir)
                    try {
                        resolver.openInputStream(imageUri)?.use { source -> file.outputStream().use(source::copyTo) }
                            ?: error("Unable to read selected image")
                        file
                    } catch (failure: Throwable) {
                        file.delete()
                        throw failure
                    }
                }

                val saved = reportOperation(
                    if (imageFile == null) "تم حفظ المنتج." else "تم حفظ المنتج وصورته.",
                ) {
                    val product = storeRepository.saveProduct(id, key, input)
                    if (product is ApiResult.Success && imageFile != null) {
                        storeRepository.updateProductImage(product.value.id, imageFile)
                    } else product
                }
                if (saved) refreshProducts(null)
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                mutableEvents.emit(StoreEvent.Failed("تعذر قراءة الصورة المحددة."))
            } finally {
                imageFile?.delete()
            }
        }
    }

    fun downloadInvoicePdf(id: Long, uri: Uri, resolver: ContentResolver) {
        viewModelScope.launch {
            mutableInvoicePdfState.value = InvoicePdfUiState(isDownloading = true, message = "جارٍ تنزيل الفاتورة PDF…")
            try {
                withContext(Dispatchers.IO) {
                    val body = storeRepository.invoicePdf(id)
                    try {
                        resolver.openOutputStream(uri)?.use { output -> body.byteStream().use { it.copyTo(output) } }
                            ?: error("Unable to open destination")
                    } finally { body.close() }
                }
                mutableInvoicePdfState.value = InvoicePdfUiState(message = "تم حفظ ملف الفاتورة PDF على الجهاز.")
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                mutableInvoicePdfState.value = InvoicePdfUiState(message = failure.message ?: "تعذر تنزيل ملف الفاتورة.", isError = true)
            }
        }
    }

    fun updateProduct(id: Long, input: ProductInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث المنتج.") { storeRepository.updateProduct(id, key, input) }) {
                refreshProducts(null)
            }
        }
    }

    fun deleteProduct(id: Long, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم حذف المنتج.") { storeRepository.deleteProduct(id, key) }) {
                refreshProducts(null)
            }
        }
    }

    fun createMaintenance(input: MaintenanceInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تمت إضافة طلب الصيانة.") { storeRepository.createMaintenance(key, input) }) {
                refreshMaintenances(null)
            }
        }
    }

    fun updateMaintenance(id: Long, input: MaintenanceInputDto) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث طلب الصيانة.") { storeRepository.updateMaintenance(id, input) }) {
                refreshMaintenances(null)
            }
        }
    }

    fun deleteMaintenance(id: Long) {
        viewModelScope.launch {
            if (reportOperation("تم حذف طلب الصيانة.") { storeRepository.deleteMaintenance(id) }) {
                refreshMaintenances(null)
            }
        }
    }

    fun createWalletTransaction(input: WalletCashierInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تسجيل العملية.") { storeRepository.createWalletTransaction(key, input) }) {
                refreshWalletCashier()
                refreshWalletOverview()
            }
        }
    }

    fun settleWalletTransaction(uuid: String, input: SettleWalletTransactionInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تسجيل التحصيل.") { storeRepository.settleWalletTransaction(uuid, key, input) }) {
                refreshWalletCashier()
                refreshWalletOverview()
            }
        }
    }

    fun reverseWalletTransaction(uuid: String, input: ReverseWalletTransactionInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم عكس العملية.") { storeRepository.reverseWalletTransaction(uuid, key, input) }) {
                refreshWalletCashier()
                refreshWalletOverview()
            }
        }
    }

    fun createWallet(input: WalletInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تمت إضافة المحفظة.") { storeRepository.createWallet(key, input) }) {
                refreshWalletOverview()
            }
        }
    }

    fun toggleWallet(id: Long, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث حالة المحفظة.") { storeRepository.toggleWallet(id, key) }) {
                refreshWalletOverview()
            }
        }
    }

    fun adjustWallet(id: Long, input: WalletAdjustmentInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تسجيل تسوية الرصيد.") { storeRepository.adjustWallet(id, key, input) }) {
                refreshWalletOverview()
            }
        }
    }

    fun loadMoreSuppliers() {
        val page = mutableSuppliers.value
        if (!page.isLoading && page.currentPage < page.lastPage) refreshSuppliers(supplierQuery, page.currentPage + 1)
    }

    fun loadSupplierDetails(id: Long) {
        supplierDetailsRequest?.cancel()
        mutableSupplierDetails.value = SupplierDetailUiState(isLoading = true)
        supplierDetailsRequest = viewModelScope.launch {
            mutableSupplierDetails.value = when (val result = storeRepository.supplierDetails(id)) {
                is ApiResult.Success -> SupplierDetailUiState(supplier = result.value)
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    SupplierDetailUiState(error = result.error.message)
                }
            }
        }
    }

    fun clearSupplierDetails() {
        supplierDetailsRequest?.cancel()
        mutableSupplierDetails.value = SupplierDetailUiState()
    }

    fun loadCategoryDetails(id: Long) {
        categoryDetailsRequest?.cancel()
        mutableCategoryDetails.value = CategoryDetailUiState(isLoading = true)
        categoryDetailsRequest = viewModelScope.launch {
            mutableCategoryDetails.value = when (val result = storeRepository.categoryDetails(id)) {
                is ApiResult.Success -> CategoryDetailUiState(category = result.value)
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    CategoryDetailUiState(error = result.error.message)
                }
            }
        }
    }

    fun clearCategoryDetails() {
        categoryDetailsRequest?.cancel()
        mutableCategoryDetails.value = CategoryDetailUiState()
    }

    fun loadCustomerDetails(id: Long) {
        customerDetailsRequest?.cancel()
        mutableCustomerDetails.value = CustomerDetailUiState(isLoading = true)
        customerDetailsRequest = viewModelScope.launch {
            mutableCustomerDetails.value = when (val result = storeRepository.customerDetails(id)) {
                is ApiResult.Success -> CustomerDetailUiState(customer = result.value)
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    CustomerDetailUiState(error = result.error.message)
                }
            }
        }
    }

    fun clearCustomerDetails() {
        customerDetailsRequest?.cancel()
        mutableCustomerDetails.value = CustomerDetailUiState()
    }

    fun refreshInstallments(query: String? = installmentQuery, page: Int = 1) {
        if (page == 1) installmentQuery = query
        val requestedQuery = installmentQuery
        installmentRequest?.cancel()
        installmentRequest = viewModelScope.launch {
            mutableInstallments.value = if (page == 1) {
                mutableInstallments.value.copy(isLoading = true, error = null)
            } else {
                mutableInstallments.value.copy(isLoading = true, error = null)
            }
            mutableInstallments.value = when (val result = storeRepository.installments(requestedQuery, page)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    if (page == 1) loaded else mutableInstallments.value.appendPage(loaded, InstallmentDto::id)
                }
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutableInstallments.value.copy(isLoading = false, error = result.error.message)
                }
            }
        }
    }

    fun loadMoreInstallments() {
        val page = mutableInstallments.value
        if (!page.isLoading && page.currentPage < page.lastPage) refreshInstallments(installmentQuery, page.currentPage + 1)
    }

    fun loadInstallmentDetails(id: Long) {
        installmentDetailsRequest?.cancel()
        mutableInstallmentDetails.value = InstallmentDetailUiState(isLoading = true)
        installmentDetailsRequest = viewModelScope.launch {
            mutableInstallmentDetails.value = when (val result = storeRepository.installmentDetails(id)) {
                is ApiResult.Success -> InstallmentDetailUiState(installment = result.value)
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    InstallmentDetailUiState(error = result.error.message)
                }
            }
        }
    }

    fun clearInstallmentDetails() {
        installmentDetailsRequest?.cancel()
        mutableInstallmentDetails.value = InstallmentDetailUiState()
    }

    fun createCustomer(input: CustomerInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تمت إضافة العميل.") { storeRepository.createCustomer(key, input) }) {
                refreshCustomers()
            }
        }
    }

    fun createSupplier(input: SupplierInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تمت إضافة المورد.") { storeRepository.createSupplier(key, input) }) {
                refreshSuppliers(null)
                refreshWalletOverview()
            }
        }
    }

    fun updateSupplier(id: Long, input: SupplierInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث بيانات المورد.") { storeRepository.updateSupplier(id, key, input) }) {
                refreshSuppliers(supplierQuery)
                refreshWalletOverview()
            }
        }
    }

    fun deleteSupplier(id: Long, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم حذف المورد وسجل مشترياته ومدفوعاته.") { storeRepository.deleteSupplier(id, key) }) {
                refreshSuppliers(supplierQuery)
                refreshWalletOverview()
            }
        }
    }

    fun createInstallment(input: InstallmentInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تمت إضافة القسط.") { storeRepository.createInstallment(key, input) }) {
                refreshInstallments(null)
            }
        }
    }

    fun updateInstallment(id: Long, input: InstallmentInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث القسط.") { storeRepository.updateInstallment(id, key, input) }) {
                refreshInstallments(null)
            }
        }
    }

    fun deleteInstallment(id: Long, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم حذف القسط.") { storeRepository.deleteInstallment(id, key) }) {
                refreshInstallments(null)
            }
        }
    }

    fun payInstallment(id: Long, input: PayAmountInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تسجيل دفعة القسط.") { storeRepository.payInstallment(id, key, input) }) {
                refreshInstallments(null)
                refreshInvoices(null)
            }
        }
    }

    fun changeInstallmentStatus(id: Long, status: String, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث حالة القسط.") {
                storeRepository.changeInstallmentStatus(id, key, InstallmentStatusInputDto(status))
            }) {
                refreshInstallments(null)
            }
        }
    }

    fun refreshPersonalDebts(query: String? = personalDebtQuery, page: Int = 1) {
        if (page == 1) personalDebtQuery = query
        val requestedQuery = personalDebtQuery
        personalDebtRequest?.cancel()
        personalDebtRequest = viewModelScope.launch {
            mutablePersonalDebts.value = if (page == 1) mutablePersonalDebts.value.copy(isLoading = true, error = null)
            else mutablePersonalDebts.value.copy(isLoading = true, error = null)
            mutablePersonalDebts.value = when (val result = storeRepository.personalDebts(requestedQuery, page)) {
                is ApiResult.Success -> {
                    val loaded = result.value.toRemotePage()
                    if (page == 1) loaded else mutablePersonalDebts.value.appendPage(loaded, PersonalDebtDto::id)
                }
                is ApiResult.Failure -> {
                    notifySessionExpiry(result.error)
                    mutablePersonalDebts.value.copy(isLoading = false, error = result.error.message)
                }
            }
        }
    }

    fun loadMorePersonalDebts() {
        val page = mutablePersonalDebts.value
        if (!page.isLoading && page.currentPage < page.lastPage) refreshPersonalDebts(personalDebtQuery, page.currentPage + 1)
    }

    fun createPersonalDebt(input: PersonalDebtInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تسجيل الدين الشخصي.") { storeRepository.createPersonalDebt(key, input) }) {
                refreshPersonalDebts(null)
            }
        }
    }

    fun updatePersonalDebt(id: Long, input: PersonalDebtInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث الدين الشخصي.") { storeRepository.updatePersonalDebt(id, key, input) }) {
                refreshPersonalDebts(null)
            }
        }
    }

    fun payPersonalDebt(id: Long, input: PayAmountInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تسجيل دفعة الدين الشخصي.") { storeRepository.payPersonalDebt(id, key, input) }) {
                refreshPersonalDebts(null)
            }
        }
    }

    fun deletePersonalDebt(id: Long, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم حذف الدين الشخصي.") { storeRepository.deletePersonalDebt(id, key) }) {
                refreshPersonalDebts(null)
            }
        }
    }

    fun payInvoice(id: Long, input: PayAmountInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تسجيل دفعة الفاتورة.") { storeRepository.payInvoice(id, key, input) }) {
                refreshInvoices(null)
                refreshInstallments(null)
            }
        }
    }

    fun refundInvoice(id: Long, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم استرداد الفاتورة وإرجاع الكميات للمخزون.") { storeRepository.refundInvoice(id, key) }) {
                refreshInvoices(null)
                refreshProducts(null)
                refreshInstallments(null)
            }
        }
    }

    fun updateInvoice(id: Long, input: InvoiceInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث الفاتورة.") { storeRepository.updateInvoice(id, key, input) }) {
                refreshInvoices(null)
                refreshProducts(null)
                refreshInstallments(null)
            }
        }
    }

    fun createCategory(input: CategoryInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تمت إضافة التصنيف.") { storeRepository.createCategory(key, input) }) {
                refreshCategories()
            }
        }
    }

    fun updateCustomer(id: Long, input: CustomerInputDto) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث العميل.") { storeRepository.updateCustomer(id, input) }) refreshCustomers()
        }
    }

    fun deleteCustomer(id: Long) {
        viewModelScope.launch {
            if (reportOperation("تم حذف العميل.") { storeRepository.deleteCustomer(id) }) refreshCustomers()
        }
    }

    fun updateCategory(id: Long, input: CategoryInputDto) {
        viewModelScope.launch {
            if (reportOperation("تم تحديث التصنيف.") { storeRepository.updateCategory(id, input) }) {
                refreshCategories()
                refreshProducts(null)
            }
        }
    }

    fun deleteCategory(id: Long) {
        viewModelScope.launch {
            if (reportOperation("تم حذف التصنيف.") { storeRepository.deleteCategory(id) }) {
                refreshCategories()
                refreshProducts()
            }
        }
    }

    fun createInvoice(input: InvoiceInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation("تم إنشاء الفاتورة.") { storeRepository.createInvoice(key, input) }) {
                refreshInvoices()
                refreshProducts(null)
            }
        }
    }

    private suspend fun <T> reportOperation(successMessage: String, operation: suspend () -> ApiResult<T>): Boolean {
        activeWrites++
        mutableIsSaving.value = true
        return try {
            when (val result = operation()) {
                is ApiResult.Success -> {
                    mutableEvents.emit(StoreEvent.Saved(successMessage))
                    true
                }
                is ApiResult.Failure -> {
                    mutableEvents.emit(
                        if (result.error == ApiFailure.Unauthorized) StoreEvent.SessionExpired
                        else StoreEvent.Failed(result.error.message),
                    )
                    false
                }
            }
        } finally {
            activeWrites--
            mutableIsSaving.value = activeWrites > 0
        }
    }

    private suspend fun notifySessionExpiry(error: ApiFailure) {
        if (error == ApiFailure.Unauthorized) mutableEvents.emit(StoreEvent.SessionExpired)
    }

    private fun <T> ApiPage<T>.toRemotePage() = RemotePage(
        items = data,
        currentPage = meta?.currentPage ?: 1,
        lastPage = meta?.lastPage ?: 1,
        total = meta?.total ?: data.size,
    )
}

internal fun <T, K> RemotePage<T>.appendPage(
    next: RemotePage<T>,
    keySelector: (T) -> K,
): RemotePage<T> = next.copy(items = (items + next.items).distinctBy(keySelector))
