package com.storemanagement.mobile.core.network

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RetailShiftDto(
    val id: Long,
    @SerialName("register_name") val registerName: String,
    @SerialName("actor_id") val actorId: Long,
    @SerialName("actor_name") val actorName: String,
    @SerialName("business_day") val businessDay: String,
    @SerialName("opened_at") val openedAt: String,
    val status: String,
    @SerialName("opening_minor") val openingMinor: Long,
    @SerialName("expected_minor") val expectedMinor: Long,
    @SerialName("observed_minor") val observedMinor: Long? = null,
    @SerialName("difference_minor") val differenceMinor: Long? = null,
    @SerialName("close_reason") val closeReason: String? = null,
    @SerialName("closed_at") val closedAt: String? = null,
    @SerialName("approved_by") val approvedBy: Long? = null,
    @SerialName("approval_reason") val approvalReason: String? = null,
    @SerialName("approved_at") val approvedAt: String? = null,
    val totals: List<RetailTenderTotalDto> = emptyList(),
    @SerialName("cash_movement_totals") val cashMovementTotals: List<RetailCashTotalDto> = emptyList(),
)

@Serializable
data class RetailTenderTotalDto(
    val method: String,
    @SerialName("received_minor") val receivedMinor: Long,
    @SerialName("paid_out_minor") val paidOutMinor: Long,
)

@Serializable
data class RetailCashTotalDto(
    val kind: String,
    @SerialName("amount_minor") val amountMinor: Long,
)

@Serializable
data class RetailCashMovementDto(
    val id: Long,
    val kind: String,
    @SerialName("amount_minor") val amountMinor: Long,
    val reason: String,
    val reference: String? = null,
    @SerialName("actor_name") val actorName: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class OpenRetailShiftDto(
    @SerialName("register_name") val registerName: String,
    @SerialName("opening_minor") val openingMinor: Long,
)

@Serializable
data class CloseRetailShiftDto(
    @SerialName("observed_minor") val observedMinor: Long,
    @SerialName("expected_minor") val expectedMinor: Long,
    val reason: String,
)

@Serializable
data class ApproveRetailShiftDto(val reason: String)

@Serializable
data class RetailSettingsDto(@SerialName("require_shift") val requireShift: Boolean)

@Serializable
data class RetailCheckoutLineDto(
    @SerialName("product_id") val productId: Long,
    val quantity: Int,
    @SerialName("device_ids") val deviceIds: List<Long>? = null,
)

@Serializable
data class RetailPaymentDto(
    val method: String,
    @SerialName("amount_minor") val amountMinor: Long,
    val reference: String? = null,
)

@Serializable
data class RetailCheckoutDto(
    @SerialName("customer_id") val customerId: Long?,
    val items: List<RetailCheckoutLineDto>,
    @SerialName("paid_minor") val paidMinor: Long,
    @SerialName("expected_total_minor") val expectedTotalMinor: Long,
    @SerialName("shift_id") val shiftId: Long?,
    val payments: List<RetailPaymentDto>?,
)

@Serializable
data class RetailCheckoutReceiptDto(
    val id: Long,
    @SerialName("invoice_number") val invoiceNumber: String? = null,
    @SerialName("total_minor") val totalMinor: Long,
    @SerialName("paid_minor") val paidMinor: Long,
)

@Serializable
data class RetailDeviceDto(
    val id: Long,
    @SerialName("product_id") val productId: Long,
    @SerialName("product_name") val productName: String,
    @SerialName("serial_number") val serialNumber: String? = null,
    val imei1: String? = null,
    val imei2: String? = null,
    val status: String,
    @SerialName("receipt_id") val receiptId: Long,
    @SerialName("purchase_id") val purchaseId: Long? = null,
    val sales: List<RetailDeviceSaleDto> = emptyList(),
    val events: List<RetailDeviceEventDto> = emptyList(),
    val returns: List<RetailDeviceReturnDto> = emptyList(),
    @SerialName("quarantine_resolutions") val quarantineResolutions: List<RetailQuarantineResolutionDto> = emptyList(),
    val repairs: List<RetailDeviceRepairDto> = emptyList(),
)

@Serializable
data class RetailDeviceSaleDto(
    @SerialName("invoice_id") val invoiceId: Long,
    @SerialName("invoice_date") val invoiceDate: String,
    @SerialName("warranty_months") val warrantyMonths: Int,
    @SerialName("warranty_basis") val warrantyBasis: String,
    @SerialName("warranty_guarantor") val warrantyGuarantor: String? = null,
    @SerialName("warranty_starts_on") val warrantyStartsOn: String? = null,
    @SerialName("warranty_expires_on") val warrantyExpiresOn: String? = null,
    @SerialName("warranty_proof_reference") val warrantyProofReference: String? = null,
    @SerialName("warranty_status") val warrantyStatus: String,
)

@Serializable
data class RetailDeviceEventDto(
    val id: Long,
    @SerialName("invoice_id") val invoiceId: Long,
    val kind: String,
    @SerialName("occurred_on") val occurredOn: String,
    val note: String = "",
    @SerialName("proof_reference") val proofReference: String? = null,
)

@Serializable
data class RetailDeviceReturnDto(
    @SerialName("return_id") val returnId: Long,
    @SerialName("invoice_id") val invoiceId: Long,
    val disposition: String,
)

@Serializable
data class RetailQuarantineResolutionDto(
    @SerialName("return_id") val returnId: Long,
    val reason: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class RetailDeviceRepairDto(
    val id: Long,
    val item: String,
    val status: String,
    @SerialName("requested_date") val requestedDate: String,
    @SerialName("completed_date") val completedDate: String? = null,
)
