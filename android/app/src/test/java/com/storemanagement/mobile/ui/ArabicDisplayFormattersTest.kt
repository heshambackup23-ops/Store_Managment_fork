package com.storemanagement.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ArabicDisplayFormattersTest {
    @Test
    fun serverInvoiceStatesAreShownInArabic() {
        assertEquals("مدفوعة", "paid".toArabicInvoiceStatus())
        assertEquals("غير مدفوعة", "unpaid".toArabicInvoiceStatus())
        assertEquals("مدفوعة جزئياً", "partial".toArabicInvoiceStatus())
        assertEquals("مستردة", "refunded".toArabicInvoiceStatus())
        assertEquals("حالة غير معروفة", "unexpected".toArabicInvoiceStatus())
    }

    @Test
    fun installmentStatusesArePresentedInArabic() {
        assertEquals("مكتمل", "مكتمل".toArabicInstallmentStatus())
        assertEquals("غير مكتمل", "غير مكتمل".toArabicInstallmentStatus())
        assertEquals("متأخر", "overdue".toArabicInstallmentStatus())
        assertEquals("حالة غير معروفة", "unexpected".toArabicInstallmentStatus())
    }

    @Test
    fun datesUseArabicMonthNames() {
        assertTrue("2026-11-09".toArabicDateDisplay().contains("نوفمبر"))
        assertEquals("تاريخ غير محدد", "invalid".toArabicDateDisplay())
    }

    @Test
    fun permissionKeysAreTranslatedInsteadOfShownRaw() {
        assertEquals("بيانات الحساب", "api:me".toArabicPermissionLabel())
        assertEquals("المنتجات: عرض", "page.products.view".toArabicPermissionLabel())
        assertEquals("الموردون: إدارة", "page.suppliers.manage".toArabicPermissionLabel())
        assertEquals("وحدة أخرى: عرض", "page.unknown.view".toArabicPermissionLabel())
        assertNull("unknown.permission".toArabicPermissionLabel())
    }
}
