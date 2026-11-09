package com.storemanagement.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class InvoiceFormValidationTest {
    @Test
    fun normalizesArabicIndicAndEasternArabicDigits() {
        assertEquals("2026-11-09", "٢٠٢٦-١١-٠٩".normalizeArabicDigits())
        assertEquals("2026-11-09", "۲۰۲۶-۱۱-۰۹".normalizeArabicDigits())
    }

    @Test
    fun invoiceDateValidationRejectsImpossibleDates() {
        assertTrue("2024-02-29".isValidInvoiceDate())
        assertTrue("٢٠٢٤-٠٢-٢٩".isValidInvoiceDate())
        assertFalse("2023-02-29".isValidInvoiceDate())
        assertFalse("2024-2-09".isValidInvoiceDate())
    }

    @Test
    fun paidAmountMustBeNonnegativeWithAtMostTwoDecimals() {
        assertTrue("0".isValidPaidAmount())
        assertTrue("125.50".isValidPaidAmount())
        assertTrue("١٢٥.٥٠".isValidPaidAmount())
        assertFalse("-1".isValidPaidAmount())
        assertFalse("1.234".isValidPaidAmount())
        assertFalse("1e2".isValidPaidAmount())
    }

}
