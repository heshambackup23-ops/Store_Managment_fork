package com.storemanagement.mobile.ui

import java.text.SimpleDateFormat
import java.util.Locale

internal fun String.normalizeArabicDigits(): String = map { digit ->
    when (digit) {
        in '٠'..'٩' -> '0' + (digit - '٠')
        in '۰'..'۹' -> '0' + (digit - '۰')
        else -> digit
    }
}.joinToString("")

internal fun String.isValidInvoiceDate(): Boolean {
    val normalized = normalizeArabicDigits()
    if (!INVOICE_DATE_PATTERN.matches(normalized)) return false
    val formatter = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { isLenient = false }
    val parsed = runCatching { formatter.parse(normalized) }.getOrNull() ?: return false
    return formatter.format(parsed) == normalized
}

internal fun String.isValidPaidAmount(): Boolean = PAID_AMOUNT_PATTERN.matches(normalizeArabicDigits())

internal fun String.isValidSignedAmount(): Boolean {
    val normalized = normalizeArabicDigits()
    val amount = normalized.toBigDecimalOrNull() ?: return false
    return SIGNED_AMOUNT_PATTERN.matches(normalized) && amount.compareTo(java.math.BigDecimal.ZERO) != 0 &&
        amount.abs() <= MAX_WALLET_ADJUSTMENT
}

private val INVOICE_DATE_PATTERN = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
private val PAID_AMOUNT_PATTERN = Regex("^[0-9]+(?:\\.[0-9]{1,2})?$")
private val SIGNED_AMOUNT_PATTERN = Regex("^-?[0-9]+(?:\\.[0-9]{1,2})?$")
private val MAX_WALLET_ADJUSTMENT = java.math.BigDecimal("99999999")
