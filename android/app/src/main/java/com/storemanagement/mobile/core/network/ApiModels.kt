package com.storemanagement.mobile.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ApiEnvelope<T>(
    val data: T,
)

@Serializable
data class ApiPage<T>(
    val data: List<T>,
    val links: PaginationLinks? = null,
    val meta: PaginationMeta? = null,
)

@Serializable
data class PaginationLinks(
    val next: String? = null,
    val prev: String? = null,
)

@Serializable
data class PaginationMeta(
    @SerialName("current_page") val currentPage: Int? = null,
    @SerialName("last_page") val lastPage: Int? = null,
    @SerialName("per_page") val perPage: Int? = null,
    val total: Int? = null,
)

@Serializable
data class TokenResponse(
    val data: TokenData,
)

@Serializable
data class TokenData(
    @SerialName("access_token") val accessToken: String,
    @SerialName("token_type") val tokenType: String,
    @SerialName("expires_at") val expiresAt: String? = null,
    val user: UserDto,
)

@Serializable
data class UserDto(
    val id: Long,
    val name: String,
    val username: String? = null,
    val roles: List<String> = emptyList(),
    val permissions: List<String> = emptyList(),
)

@Serializable
data class ProductDto(
    val id: Long,
    val name: String,
    val price: String,
    val description: String,
    val barcode: String? = null,
    val stock: Int,
    val category: CategoryDto? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class CategoryDto(
    val id: Long,
    val name: String,
    @SerialName("products_count") val productsCount: Int? = null,
)

@Serializable
data class CustomerDto(
    val id: Long,
    val name: String,
    val phone: String? = null,
    val address: String,
)

@Serializable
data class SupplierDto(
    val id: Long,
    val name: String,
    val phone: String? = null,
    val email: String? = null,
    val address: String? = null,
    @SerialName("opening_balance") val openingBalance: String,
    val balance: String,
    @SerialName("purchases_count") val purchasesCount: Int? = null,
)

@Serializable
data class InstallmentDto(
    val id: Long,
    @SerialName("invoice_id") val invoiceId: Long? = null,
    @SerialName("customer_id") val customerId: Long? = null,
    val customer: String,
    @SerialName("product_id") val productId: Long? = null,
    @SerialName("product_name") val productName: String,
    @SerialName("product_price") val productPrice: String,
    @SerialName("payment_date") val paymentDate: String? = null,
    @SerialName("next_payment_date") val nextPaymentDate: String? = null,
    @SerialName("paid_amount") val paidAmount: String,
    val remaining: String,
    val quantity: Int,
    val status: String,
    val items: List<InvoiceItemDto> = emptyList(),
)

@Serializable
data class InvoiceDto(
    val id: Long,
    @SerialName("invoice_number") val invoiceNumber: String,
    val customer: String,
    @SerialName("invoice_date") val invoiceDate: String,
    val status: String,
    val quantity: Int,
    @SerialName("total_amount") val totalAmount: String,
    @SerialName("paid_amount") val paidAmount: String,
    @SerialName("remaining_amount") val remainingAmount: String,
    val items: List<InvoiceItemDto> = emptyList(),
    val notes: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class InvoiceItemDto(
    @SerialName("product_id") val productId: Long? = null,
    val name: String? = null,
    val price: String? = null,
    val quantity: Int? = null,
    @SerialName("line_total") val lineTotal: String? = null,
)

@Serializable
data class LoginRequestDto(
    val username: String,
    val password: String,
    @SerialName("device_name") val deviceName: String,
)

@Serializable
data class CustomerInputDto(
    val name: String,
    val phone: String,
    val address: String,
)

@Serializable
data class CategoryInputDto(
    val name: String,
)

@Serializable
data class InvoiceInputDto(
    val customer: String,
    @SerialName("product_ids") val productIds: List<Long>,
    val quantities: List<Int>,
    @SerialName("invoice_date") val invoiceDate: String,
    @SerialName("paid_amount") val paidAmount: String,
    val notes: String? = null,
)
