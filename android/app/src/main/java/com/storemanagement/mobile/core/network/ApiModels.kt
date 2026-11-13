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
data class ProfileDto(
    val id: Long,
    val name: String,
    val username: String? = null,
    val email: String? = null,
)

@Serializable
data class ProfileInputDto(
    val name: String,
    val email: String? = null,
    @SerialName("current_password") val currentPassword: String? = null,
    val password: String? = null,
    @SerialName("password_confirmation") val passwordConfirmation: String? = null,
)

@Serializable
data class DamagedItemDto(
    val id: Long,
    @SerialName("product_id") val productId: Long,
    @SerialName("product_name") val productName: String,
    @SerialName("product_barcode") val productBarcode: String? = null,
    val quantity: Int,
    @SerialName("unit_value") val unitValue: String,
    @SerialName("total_value") val totalValue: String,
    val reason: String,
    @SerialName("reason_label") val reasonLabel: String,
    val status: String,
    @SerialName("damaged_on") val damagedOn: String,
    val notes: String? = null,
    @SerialName("stock_before") val stockBefore: Int,
    @SerialName("stock_after") val stockAfter: Int,
    @SerialName("void_reason") val voidReason: String? = null,
)

@Serializable
data class DamagedProductDto(
    val id: Long,
    val name: String,
    val barcode: String? = null,
    val price: String,
    val stock: Int,
)

@Serializable
data class DamagedItemInputDto(
    @SerialName("product_id") val productId: Long,
    val quantity: Int,
    val reason: String,
    @SerialName("unit_value") val unitValue: String? = null,
    @SerialName("damaged_on") val damagedOn: String,
    val notes: String? = null,
)

@Serializable
data class VoidDamagedItemInputDto(val reason: String)

@Serializable
data class ProductDto(
    val id: Long,
    val name: String,
    val price: String,
    val description: String? = null,
    val notes: String? = null,
    val barcode: String? = null,
    val stock: Int,
    val category: CategoryDto? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("updated_at") val updatedAt: String? = null,
)

@Serializable
data class ProductInputDto(
    val name: String,
    val price: String,
    val description: String? = null,
    val notes: String? = null,
    val barcode: String? = null,
    val stock: Int,
    @SerialName("category_id") val categoryId: Long? = null,
    @SerialName("expected_stock") val expectedStock: Int? = null,
)

@Serializable
data class SoldProductDto(
    val id: Long,
    val name: String,
    @SerialName("sold_quantity") val soldQuantity: Int,
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
    val address: String? = null,
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
data class SupplierInputDto(
    val name: String,
    val phone: String? = null,
    val email: String? = null,
    val address: String? = null,
    @SerialName("opening_balance") val openingBalance: String? = null,
)

@Serializable
data class WalletOverviewDto(
    val summary: WalletSummaryDto,
    val wallets: List<WalletDto> = emptyList(),
)

@Serializable
data class NotificationDto(
    val id: Long,
    val title: String,
    val message: String,
    @SerialName("starts_at") val startsAt: String? = null,
    @SerialName("ends_at") val endsAt: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("is_read") val isRead: Boolean = false,
)

@Serializable
data class MaintenanceDto(
    val id: Long,
    val name: String,
    val owner: String,
    val phone: String? = null,
    val address: String? = null,
    val description: String? = null,
    val status: String,
    @SerialName("requested_date") val requestedDate: String,
    @SerialName("completed_date") val completedDate: String? = null,
)

@Serializable
data class MaintenanceInputDto(
    val name: String,
    val owner: String,
    val phone: String? = null,
    val address: String? = null,
    val description: String? = null,
    val status: String,
    @SerialName("requested_date") val requestedDate: String,
)

@Serializable
data class WalletCashierDto(
    val wallets: List<CashierWalletDto> = emptyList(),
    val transactions: List<WalletCashierTransactionDto> = emptyList(),
    val outstanding: String = "0.00",
)

@Serializable
data class CashierWalletDto(
    val id: Long,
    val name: String,
    val provider: String,
    val identifier: String? = null,
    val balance: String,
    @SerialName("per_transaction_limit") val perTransactionLimit: String? = null,
    @SerialName("default_commission_percent") val defaultCommissionPercent: String? = null,
    @SerialName("default_commission_min") val defaultCommissionMin: String? = null,
    @SerialName("default_fee_percent") val defaultFeePercent: String? = null,
    @SerialName("default_fee_min") val defaultFeeMin: String? = null,
    @SerialName("default_fee_max") val defaultFeeMax: String? = null,
)

@Serializable
data class WalletCashierTransactionDto(
    val uuid: String,
    @SerialName("wallet_id") val walletId: Long,
    @SerialName("wallet_name") val walletName: String? = null,
    val type: String,
    val status: String,
    val amount: String,
    val commission: String,
    val fee: String,
    val counterparty: String? = null,
    @SerialName("customer_name") val customerName: String? = null,
    @SerialName("payment_method") val paymentMethod: String,
    val receivable: String,
    @SerialName("occurred_at") val occurredAt: String? = null,
    @SerialName("can_settle") val canSettle: Boolean = false,
    @SerialName("can_reverse") val canReverse: Boolean = false,
)

@Serializable
data class WalletCashierInputDto(
    @SerialName("wallet_id") val walletId: Long,
    val type: String,
    val amount: String,
    val counterparty: String,
    val commission: String? = null,
    val fee: String? = null,
    @SerialName("payment_method") val paymentMethod: String? = null,
    @SerialName("customer_name") val customerName: String? = null,
    val notes: String? = null,
)

@Serializable
data class SettleWalletTransactionInputDto(val amount: String? = null)

@Serializable
data class ReverseWalletTransactionInputDto(val reason: String)

@Serializable
data class WalletLedgerActionDto(val uuid: String)

@Serializable
data class CashierSearchResponseDto(
    val exact: Boolean = false,
    val data: List<CashierProductDto> = emptyList(),
)

@Serializable
data class CashierProductDto(
    val id: Long,
    val name: String,
    val price: String,
    val barcode: String? = null,
    val stock: Int,
    @SerialName("image_url") val imageUrl: String? = null,
)

@Serializable
data class CashierCheckoutItemDto(
    @SerialName("product_id") val productId: Long,
    val quantity: Int,
)

@Serializable
data class CashierCheckoutInputDto(
    val customer: String? = null,
    val items: List<CashierCheckoutItemDto>,
    val received: String? = null,
)

@Serializable
data class CashierCheckoutResponseDto(
    @SerialName("invoice_id") val invoiceId: Long,
    @SerialName("invoice_number") val invoiceNumber: String,
    val total: String,
    val paid: String,
    val remaining: String,
    val change: String,
)

@Serializable
data class PayAmountInputDto(val amount: String? = null, val notes: String? = null)

@Serializable
data class InstallmentStatusInputDto(val status: String)

@Serializable
data class PersonalDebtDto(
    val id: Long,
    val creditor: String,
    val description: String? = null,
    @SerialName("total_amount") val totalAmount: String,
    @SerialName("paid_amount") val paidAmount: String,
    val remaining: String,
    @SerialName("due_date") val dueDate: String? = null,
    val status: String,
    val notes: String? = null,
    val payments: List<PersonalDebtPaymentDto> = emptyList(),
)

@Serializable
data class PersonalDebtPaymentDto(
    val id: Long,
    val amount: String,
    @SerialName("paid_on") val paidOn: String? = null,
    val notes: String? = null,
)

@Serializable
data class PersonalDebtInputDto(
    val creditor: String,
    val description: String? = null,
    @SerialName("total_amount") val totalAmount: String,
    @SerialName("paid_amount") val paidAmount: String? = null,
    @SerialName("due_date") val dueDate: String? = null,
    val notes: String? = null,
)

@Serializable
data class WalletSummaryDto(
    @SerialName("wallets_total") val walletsTotal: String,
    val cash: String? = null,
    @SerialName("profit_today") val profitToday: String? = null,
    @SerialName("profit_available") val profitAvailable: String? = null,
    val receivables: String,
    val capital: String? = null,
)

@Serializable
data class WalletDto(
    val id: Long,
    val name: String,
    val provider: String,
    val identifier: String? = null,
    val balance: String,
    @SerialName("is_active") val isActive: Boolean,
    @SerialName("warn_at_percent") val warnAtPercent: Int,
    val limits: List<WalletLimitDto> = emptyList(),
)

@Serializable
data class WalletInputDto(
    val name: String,
    val provider: String,
    val identifier: String? = null,
    @SerialName("opening_balance") val openingBalance: String,
)

@Serializable
data class WalletAdjustmentInputDto(
    val amount: String,
    val reason: String,
)

@Serializable
data class WalletActionDto(
    val id: Long,
    @SerialName("is_active") val isActive: Boolean? = null,
)

@Serializable
data class WalletLimitDto(
    val label: String,
    val used: String,
    val limit: String? = null,
    val remaining: String? = null,
    val percent: Int? = null,
    val level: String,
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
    val phone: String? = null,
    val address: String? = null,
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

@Serializable
data class InstallmentInputDto(
    val customer: String,
    @SerialName("product_ids") val productIds: List<Long>? = null,
    val quantities: List<Int>? = null,
    @SerialName("product_name") val productName: String? = null,
    @SerialName("total_amount") val totalAmount: String? = null,
    @SerialName("payment_date") val paymentDate: String? = null,
    @SerialName("next_payment_date") val nextPaymentDate: String? = null,
    @SerialName("paid_amount") val paidAmount: String,
    val notes: String? = null,
)
