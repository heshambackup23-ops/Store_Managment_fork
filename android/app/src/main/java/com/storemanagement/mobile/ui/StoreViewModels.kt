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
import com.storemanagement.mobile.core.network.ProductDto
import com.storemanagement.mobile.core.network.SupplierDto
import com.storemanagement.mobile.core.network.UserDto
import com.storemanagement.mobile.data.AppPreferencesRepository
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
import javax.inject.Inject

data class SessionUiState(
    val isRestoring: Boolean = false,
    val isSubmitting: Boolean = false,
    val user: UserDto? = null,
    val error: String? = null,
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

sealed interface StoreEvent {
    data class Saved(val message: String) : StoreEvent
    data class Failed(val message: String) : StoreEvent
    data object SessionExpired : StoreEvent
}

@HiltViewModel
class StoreViewModel @Inject constructor(
    private val storeRepository: StoreRepository,
    private val sessionRepository: SessionRepository,
    private val preferencesRepository: AppPreferencesRepository,
) : ViewModel() {
    val isDarkTheme = preferencesRepository.isDarkTheme.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        false,
    )
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
    private val mutableInvoices = MutableStateFlow(RemotePage<InvoiceDto>())
    val invoices = mutableInvoices
    private val mutableSuppliers = MutableStateFlow(RemotePage<SupplierDto>())
    val suppliers = mutableSuppliers
    private val mutableInstallments = MutableStateFlow(RemotePage<InstallmentDto>())
    val installments = mutableInstallments
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

    private var productQuery: String? = null
    private var productCategoryId: Long? = null
    private var productStockFilter: Boolean? = null
    private var categoryQuery: String? = null
    private var customerQuery: String? = null
    private var invoiceQuery: String? = null
    private var supplierQuery: String? = null
    private var installmentQuery: String? = null
    private var productRequest: Job? = null
    private var productDetailsRequest: Job? = null
    private var invoiceDetailsRequest: Job? = null
    private var supplierDetailsRequest: Job? = null
    private var categoryDetailsRequest: Job? = null
    private var customerDetailsRequest: Job? = null
    private var installmentDetailsRequest: Job? = null
    private var categoryRequest: Job? = null
    private var customerRequest: Job? = null
    private var invoiceRequest: Job? = null
    private var supplierRequest: Job? = null
    private var installmentRequest: Job? = null

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
                RemotePage(isLoading = true)
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
                RemotePage(isLoading = true)
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

    fun refreshInvoices(query: String? = invoiceQuery, page: Int = 1) {
        if (page == 1) invoiceQuery = query
        val requestedQuery = invoiceQuery
        invoiceRequest?.cancel()
        invoiceRequest = viewModelScope.launch {
            mutableInvoices.value = if (page == 1) {
                RemotePage(isLoading = true)
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
                RemotePage(isLoading = true)
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
                RemotePage(isLoading = true)
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

    fun setDarkTheme(enabled: Boolean) {
        viewModelScope.launch {
            preferencesRepository.setDarkTheme(enabled)
        }
    }

    fun createCustomer(input: CustomerInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation(storeRepository.createCustomer(key, input), "تمت إضافة العميل.")) {
                refreshCustomers()
            }
        }
    }

    fun createCategory(input: CategoryInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation(storeRepository.createCategory(key, input), "تمت إضافة التصنيف.")) {
                refreshCategories()
            }
        }
    }

    fun updateCustomer(id: Long, input: CustomerInputDto) {
        viewModelScope.launch {
            if (reportOperation(storeRepository.updateCustomer(id, input), "تم تحديث العميل.")) refreshCustomers()
        }
    }

    fun deleteCustomer(id: Long) {
        viewModelScope.launch {
            if (reportOperation(storeRepository.deleteCustomer(id), "تم حذف العميل.")) refreshCustomers()
        }
    }

    fun updateCategory(id: Long, input: CategoryInputDto) {
        viewModelScope.launch {
            if (reportOperation(storeRepository.updateCategory(id, input), "تم تحديث التصنيف.")) {
                refreshCategories()
                refreshProducts(null)
            }
        }
    }

    fun deleteCategory(id: Long) {
        viewModelScope.launch {
            if (reportOperation(storeRepository.deleteCategory(id), "تم حذف التصنيف.")) {
                refreshCategories()
                refreshProducts()
            }
        }
    }

    fun createInvoice(input: InvoiceInputDto, key: String) {
        viewModelScope.launch {
            if (reportOperation(storeRepository.createInvoice(key, input), "تم إنشاء الفاتورة.")) {
                refreshInvoices()
                refreshProducts(null)
            }
        }
    }

    private suspend fun <T> reportOperation(result: ApiResult<T>, successMessage: String): Boolean {
        mutableEvents.emit(
            when (result) {
                is ApiResult.Success -> StoreEvent.Saved(successMessage)
                is ApiResult.Failure -> if (result.error == ApiFailure.Unauthorized) {
                    StoreEvent.SessionExpired
                } else {
                    StoreEvent.Failed(result.error.message)
                }
            },
        )
        return result is ApiResult.Success
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
