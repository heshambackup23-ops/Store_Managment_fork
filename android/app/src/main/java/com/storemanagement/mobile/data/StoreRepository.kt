package com.storemanagement.mobile.data

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
import com.storemanagement.mobile.core.network.ProductDto
import com.storemanagement.mobile.core.network.StoreApi
import com.storemanagement.mobile.core.network.SupplierDto
import kotlinx.coroutines.flow.Flow
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class StoreRepository @Inject constructor(
    private val api: StoreApi,
    private val calls: ApiCallExecutor,
    private val catalogDao: CatalogDao,
) {
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
            if (page == 1 && query.isNullOrBlank() && categoryId == null && inStock == null) {
                catalogDao.clearProducts()
            }
            catalogDao.upsertProducts(result.value.data.map { it.toCached(now) })
        }
        return result
    }

    suspend fun productDetails(id: Long): ApiResult<ProductDto> {
        val result = calls.execute { api.product(id).data }
        if (result is ApiResult.Success) {
            catalogDao.upsertProducts(listOf(result.value.toCached(System.currentTimeMillis())))
        }
        return result
    }

    suspend fun findProductByBarcode(rawCode: String): ApiResult<ProductDto?> {
        val barcode = rawCode.trim()
        if (barcode.isEmpty()) return ApiResult.Success(null)

        return calls.execute {
            api.products(query = barcode, page = 1, perPage = 100).data
                .firstOrNull { it.barcode == barcode }
                ?.also { catalogDao.upsertProducts(listOf(it.toCached(System.currentTimeMillis()))) }
        }
    }

    suspend fun refreshCategories(query: String? = null, page: Int = 1): ApiResult<ApiPage<CategoryDto>> {
        val result = calls.execute { api.categories(query = query, page = page, perPage = 100) }
        if (result is ApiResult.Success && query.isNullOrBlank()) {
            val now = System.currentTimeMillis()
            if (page == 1) catalogDao.clearCategories()
            catalogDao.upsertCategories(result.value.data.map { it.toCached(now) })
        }
        return result
    }

    suspend fun customers(query: String? = null, page: Int = 1): ApiResult<ApiPage<CustomerDto>> =
        calls.execute { api.customers(query = query, page = page) }

    suspend fun suppliers(query: String? = null, page: Int = 1): ApiResult<ApiPage<SupplierDto>> =
        calls.execute { api.suppliers(query = query, page = page) }

    suspend fun supplierDetails(id: Long): ApiResult<SupplierDto> =
        calls.execute { api.supplier(id).data }

    suspend fun installments(query: String? = null, page: Int = 1): ApiResult<ApiPage<InstallmentDto>> =
        calls.execute { api.installments(query = query, page = page) }

    suspend fun installmentDetails(id: Long): ApiResult<InstallmentDto> =
        calls.execute { api.installment(id).data }

    suspend fun invoices(query: String? = null, page: Int = 1): ApiResult<ApiPage<InvoiceDto>> =
        calls.execute { api.invoices(query = query, page = page) }

    suspend fun invoiceDetails(id: Long): ApiResult<InvoiceDto> =
        calls.execute { api.invoice(id).data }

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

    private fun retrofit2.Response<Unit>.requireSuccess() {
        if (!isSuccessful) throw retrofit2.HttpException(this)
    }

    private fun ProductDto.toCached(now: Long) = CachedProduct(
        id = id,
        name = name,
        price = price,
        description = description,
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
