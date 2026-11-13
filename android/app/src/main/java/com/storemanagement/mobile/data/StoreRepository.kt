package com.storemanagement.mobile.data

import com.storemanagement.mobile.BuildConfig
import com.storemanagement.mobile.core.database.CachedCategory
import com.storemanagement.mobile.core.database.CachedProduct
import com.storemanagement.mobile.core.database.CatalogDao
import com.storemanagement.mobile.core.network.ApiCallExecutor
import com.storemanagement.mobile.core.network.ApiEnvelope
import com.storemanagement.mobile.core.network.ApiPage
import com.storemanagement.mobile.core.network.ApiResult
import com.storemanagement.mobile.core.network.CategoryDto
import com.storemanagement.mobile.core.network.CategoryInputDto
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
import com.storemanagement.mobile.core.network.StoreApi
import com.storemanagement.mobile.core.network.SupplierDto
import com.storemanagement.mobile.core.network.SupplierInputDto
import com.storemanagement.mobile.core.network.SoldProductDto
import com.storemanagement.mobile.core.network.NotificationDto
import com.storemanagement.mobile.core.network.MaintenanceDto
import com.storemanagement.mobile.core.network.CashierSearchResponseDto
import com.storemanagement.mobile.core.network.CashierCheckoutInputDto
import com.storemanagement.mobile.core.network.CashierCheckoutResponseDto
import com.storemanagement.mobile.core.network.PayAmountInputDto
import com.storemanagement.mobile.core.network.ProfileDto
import com.storemanagement.mobile.core.network.ProfileInputDto
import com.storemanagement.mobile.core.network.DamagedItemDto
import com.storemanagement.mobile.core.network.DamagedProductDto
import com.storemanagement.mobile.core.network.DamagedItemInputDto
import com.storemanagement.mobile.core.network.VoidDamagedItemInputDto
import com.storemanagement.mobile.core.network.MaintenanceInputDto
import com.storemanagement.mobile.core.network.WalletOverviewDto
import com.storemanagement.mobile.core.network.WalletInputDto
import com.storemanagement.mobile.core.network.WalletAdjustmentInputDto
import com.storemanagement.mobile.core.network.WalletCashierDto
import com.storemanagement.mobile.core.network.WalletCashierInputDto
import com.storemanagement.mobile.core.network.SettleWalletTransactionInputDto
import com.storemanagement.mobile.core.network.ReverseWalletTransactionInputDto
import kotlinx.coroutines.flow.Flow
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import java.io.File
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody

@Singleton
class StoreRepository @Inject constructor(
    private val api: StoreApi,
    private val calls: ApiCallExecutor,
    private val catalogDao: CatalogDao,
) {
    suspend fun downloadBackup(pages: List<String>): ResponseBody = api.downloadBackup(pages)

    suspend fun importBackup(pages: List<String>, file: File) {
        val part = MultipartBody.Part.createFormData(
            "file", file.name, file.asRequestBody("application/zip".toMediaType()),
        )
        val response = api.importBackup(part, org.json.JSONArray(pages).toString().toRequestBody("text/plain".toMediaType()))
        if (!response.isSuccessful) throw retrofit2.HttpException(response)
        response.body()?.close()
    }

    /** A failed cache write (full disk, closed DB) must never turn a successful server call into an error. */
    private suspend fun cacheQuietly(block: suspend () -> Unit) {
        try {
            block()
        } catch (cancelled: kotlinx.coroutines.CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // The next refresh rewrites the cache.
        }
    }

    suspend fun profile(): ApiResult<ProfileDto> = calls.execute { api.profile().data }

    suspend fun updateProfile(input: ProfileInputDto) = calls.execute { api.updateProfile(input) }

    suspend fun damagedItems(query: String? = null, status: String? = null, page: Int = 1): ApiResult<ApiPage<DamagedItemDto>> =
        calls.execute { api.damagedItems(query = query, status = status, page = page) }

    suspend fun damagedProducts(query: String? = null): ApiResult<List<DamagedProductDto>> =
        calls.execute { api.damagedProducts(query).data }

    suspend fun createDamagedItem(key: String, input: DamagedItemInputDto) = calls.execute {
        api.createDamagedItem(key, input)
    }

    suspend fun updateDamagedItem(id: Long, key: String, input: DamagedItemInputDto) = calls.execute {
        api.updateDamagedItem(id, key, input)
    }

    suspend fun voidDamagedItem(id: Long, key: String, input: VoidDamagedItemInputDto) = calls.execute {
        api.voidDamagedItem(id, key, input)
    }

    fun observeProducts(): Flow<List<CachedProduct>> = catalogDao.observeProducts()

    fun observeProductCacheTime(): Flow<Long?> = catalogDao.observeProductCacheTime()

    fun observeCategories(): Flow<List<CachedCategory>> = catalogDao.observeCategories()

    suspend fun categoryDetails(id: Long): ApiResult<CategoryDto> =
        calls.execute { api.category(id).data }

    suspend fun customerDetails(id: Long): ApiResult<CustomerDto> =
        calls.execute { api.customer(id).data }

    suspend fun refreshProducts(
        query: String?,
        page: Int,
        categoryId: Long? = null,
        inStock: Boolean? = null,
    ): ApiResult<ApiPage<ProductDto>> {
        val result = calls.execute {
            api.products(query = query, page = page, categoryId = categoryId, inStock = inStock)
        }
        if (result is ApiResult.Success) {
            val now = System.currentTimeMillis()
            val cached = result.value.data.map { it.toCached(now) }
            cacheQuietly {
                if (page == 1 && query.isNullOrBlank() && categoryId == null && inStock == null) {
                    catalogDao.replaceProducts(cached)
                } else {
                    catalogDao.upsertProducts(cached)
                }
            }
        }
        return result
    }

    suspend fun createProduct(key: String, input: ProductInputDto) = calls.execute {
        api.createProduct(key, input)
    }

    suspend fun saveProduct(id: Long?, key: String, input: ProductInputDto): ApiResult<ProductDto> = calls.execute {
        if (id == null) api.createProduct(key, input).data else api.updateProduct(id, key, input).data
    }

    suspend fun updateProductImage(id: Long, file: File): ApiResult<ProductDto> = calls.execute {
        val image = MultipartBody.Part.createFormData(
            "image", file.name, file.asRequestBody("image/*".toMediaType()),
        )
        api.updateProductImage(id, image).data
    }

    suspend fun updateProduct(id: Long, key: String, input: ProductInputDto) = calls.execute {
        api.updateProduct(id, key, input)
    }

    suspend fun deleteProduct(id: Long, key: String) = calls.execute {
        api.deleteProduct(id, key).requireSuccess()
    }

    suspend fun productDetails(id: Long): ApiResult<ProductDto> {
        val result = calls.execute { api.product(id).data }
        if (result is ApiResult.Success) {
            cacheQuietly { catalogDao.upsertProducts(listOf(result.value.toCached(System.currentTimeMillis()))) }
        }
        return result
    }

    suspend fun findProductByBarcode(rawCode: String): ApiResult<ProductDto?> {
        val barcode = rawCode.trim()
        if (barcode.isEmpty()) return ApiResult.Success(null)

        return calls.execute {
            api.products(query = barcode, page = 1, perPage = 100).data
                .firstOrNull { it.barcode == barcode }
                ?.also { found -> cacheQuietly { catalogDao.upsertProducts(listOf(found.toCached(System.currentTimeMillis()))) } }
        }
    }

    suspend fun refreshCategories(query: String? = null, page: Int = 1): ApiResult<ApiPage<CategoryDto>> {
        val result = calls.execute { api.categories(query = query, page = page, perPage = 100) }
        if (result is ApiResult.Success && query.isNullOrBlank()) {
            val now = System.currentTimeMillis()
            val cached = result.value.data.map { it.toCached(now) }
            cacheQuietly {
                if (page == 1) catalogDao.replaceCategories(cached) else catalogDao.upsertCategories(cached)
            }
        }
        return result
    }

    suspend fun customers(query: String? = null, page: Int = 1): ApiResult<ApiPage<CustomerDto>> =
        calls.execute { api.customers(query = query, page = page) }

    suspend fun sales(query: String? = null, page: Int = 1): ApiResult<ApiPage<SoldProductDto>> =
        calls.execute { api.sales(query = query, page = page) }

    suspend fun cashierProducts(query: String?): ApiResult<CashierSearchResponseDto> =
        calls.execute { api.cashierProducts(query) }

    suspend fun cashierCheckout(key: String, input: CashierCheckoutInputDto): ApiResult<ApiEnvelope<CashierCheckoutResponseDto>> =
        calls.execute { api.cashierCheckout(key, input) }

    suspend fun notifications(page: Int = 1): ApiResult<ApiPage<NotificationDto>> =
        calls.execute { api.notifications(page = page) }

    suspend fun markNotificationRead(id: Long) = calls.execute {
        api.markNotificationRead(id).requireSuccess()
    }

    suspend fun markAllNotificationsRead() = calls.execute {
        api.markAllNotificationsRead().requireSuccess()
    }

    suspend fun maintenance(query: String? = null, page: Int = 1): ApiResult<ApiPage<MaintenanceDto>> =
        calls.execute { api.maintenance(query = query, page = page) }

    suspend fun createMaintenance(key: String, input: MaintenanceInputDto) = calls.execute {
        api.createMaintenance(key, input)
    }

    suspend fun updateMaintenance(id: Long, input: MaintenanceInputDto, key: String) = calls.execute {
        api.updateMaintenance(id, key, input)
    }

    suspend fun deleteMaintenance(id: Long) = calls.execute {
        api.deleteMaintenance(id).requireSuccess()
    }

    suspend fun walletCashier(provider: String?): ApiResult<WalletCashierDto> = calls.execute { api.walletCashier(provider).data }

    suspend fun createWalletTransaction(key: String, input: WalletCashierInputDto) = calls.execute {
        api.createWalletTransaction(key, input)
    }

    suspend fun settleWalletTransaction(uuid: String, key: String, input: SettleWalletTransactionInputDto) = calls.execute {
        api.settleWalletTransaction(uuid, key, input)
    }

    suspend fun reverseWalletTransaction(uuid: String, key: String, input: ReverseWalletTransactionInputDto) = calls.execute {
        api.reverseWalletTransaction(uuid, key, input)
    }

    suspend fun suppliers(query: String? = null, page: Int = 1): ApiResult<ApiPage<SupplierDto>> =
        calls.execute { api.suppliers(query = query, page = page) }

    suspend fun createSupplier(key: String, input: SupplierInputDto) = calls.execute {
        api.createSupplier(key, input)
    }

    suspend fun updateSupplier(id: Long, key: String, input: SupplierInputDto) = calls.execute {
        api.updateSupplier(id, key, input)
    }

    suspend fun deleteSupplier(id: Long, key: String) = calls.execute {
        api.deleteSupplier(id, key).requireSuccess()
    }

    suspend fun supplierDetails(id: Long): ApiResult<SupplierDto> =
        calls.execute { api.supplier(id).data }

    suspend fun installments(query: String? = null, page: Int = 1): ApiResult<ApiPage<InstallmentDto>> =
        calls.execute { api.installments(query = query, page = page) }

    suspend fun createInstallment(key: String, input: InstallmentInputDto) = calls.execute {
        api.createInstallment(key, input)
    }

    suspend fun updateInstallment(id: Long, key: String, input: InstallmentInputDto) = calls.execute {
        api.updateInstallment(id, key, input)
    }

    suspend fun deleteInstallment(id: Long, key: String) = calls.execute {
        api.deleteInstallment(id, key).requireSuccess()
    }

    suspend fun payInstallment(id: Long, key: String, input: PayAmountInputDto) = calls.execute {
        api.payInstallment(id, key, input)
    }

    suspend fun changeInstallmentStatus(id: Long, key: String, input: InstallmentStatusInputDto) = calls.execute {
        api.changeInstallmentStatus(id, key, input)
    }

    suspend fun personalDebts(query: String? = null, page: Int = 1): ApiResult<ApiPage<PersonalDebtDto>> =
        calls.execute { api.personalDebts(query = query, page = page) }

    suspend fun createPersonalDebt(key: String, input: PersonalDebtInputDto) = calls.execute {
        api.createPersonalDebt(key, input)
    }

    suspend fun updatePersonalDebt(id: Long, key: String, input: PersonalDebtInputDto) = calls.execute {
        api.updatePersonalDebt(id, key, input)
    }

    suspend fun payPersonalDebt(id: Long, key: String, input: PayAmountInputDto) = calls.execute {
        api.payPersonalDebt(id, key, input)
    }

    suspend fun deletePersonalDebt(id: Long, key: String) = calls.execute {
        api.deletePersonalDebt(id, key).requireSuccess()
    }

    suspend fun walletOverview(): ApiResult<WalletOverviewDto> = calls.execute {
        api.wallets().data
    }

    suspend fun createWallet(key: String, input: WalletInputDto) = calls.execute {
        api.createWallet(key, input)
    }

    suspend fun toggleWallet(id: Long, key: String) = calls.execute {
        api.toggleWallet(id, key)
    }

    suspend fun adjustWallet(id: Long, key: String, input: WalletAdjustmentInputDto) = calls.execute {
        api.adjustWallet(id, key, input)
    }

    suspend fun installmentDetails(id: Long): ApiResult<InstallmentDto> =
        calls.execute { api.installment(id).data }

    suspend fun invoices(query: String? = null, page: Int = 1): ApiResult<ApiPage<InvoiceDto>> =
        calls.execute { api.invoices(query = query, page = page) }

    suspend fun invoiceDetails(id: Long): ApiResult<InvoiceDto> =
        calls.execute { api.invoice(id).data }

    suspend fun invoicePdf(id: Long): ResponseBody {
        if (BuildConfig.FLAVOR != "staging") return api.invoicePdf(id)
        val invoice = api.invoice(id).data
        return renderInvoicePdf(invoice).toResponseBody("application/pdf".toMediaType())
    }

    suspend fun payInvoice(id: Long, key: String, input: PayAmountInputDto) = calls.execute {
        api.payInvoice(id, key, input)
    }

    suspend fun refundInvoice(id: Long, key: String) = calls.execute {
        api.refundInvoice(id, key)
    }

    suspend fun createCustomer(key: String, input: CustomerInputDto) = calls.execute {
        api.createCustomer(key, input)
    }

    suspend fun updateCustomer(id: Long, input: CustomerInputDto) = calls.execute {
        api.updateCustomer(id, input)
    }

    suspend fun deleteCustomer(id: Long) = calls.execute {
        api.deleteCustomer(id).requireSuccess()
    }

    suspend fun createCategory(key: String, input: CategoryInputDto) = calls.execute {
        api.createCategory(key, input)
    }

    suspend fun updateCategory(id: Long, input: CategoryInputDto) = calls.execute {
        api.updateCategory(id, input)
    }

    suspend fun deleteCategory(id: Long) = calls.execute {
        api.deleteCategory(id).requireSuccess()
    }

    suspend fun createInvoice(key: String, input: InvoiceInputDto): ApiResult<ApiEnvelope<InvoiceDto>> =
        calls.execute { api.createInvoice(key, input) }

    suspend fun updateInvoice(id: Long, key: String, input: InvoiceInputDto) = calls.execute {
        api.updateInvoice(id, key, input)
    }

    private fun retrofit2.Response<Unit>.requireSuccess() {
        if (!isSuccessful) throw retrofit2.HttpException(this)
    }

    private fun ProductDto.toCached(now: Long) = CachedProduct(
        id = id,
        name = name,
        price = price,
        description = description.orEmpty(),
        notes = notes,
        barcode = barcode,
        stock = stock,
        categoryId = category?.id,
        categoryName = category?.name,
        imageUrl = imageUrl,
        serverUpdatedAt = updatedAt,
        cachedAtEpochMillis = now,
    )

    private fun CategoryDto.toCached(now: Long) = CachedCategory(
        id = id,
        name = name,
        productsCount = productsCount,
        cachedAtEpochMillis = now,
    )
}
