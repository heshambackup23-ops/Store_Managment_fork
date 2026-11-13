package com.storemanagement.mobile.data

import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.storemanagement.mobile.core.network.InvoiceDto
import com.storemanagement.mobile.core.network.InvoiceItemDto
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AndroidInvoicePdfTest {
    @Test
    fun opensMultiPageArabicInvoiceInAndroidPdfRenderer() {
        val invoice = InvoiceDto(
            id = 712,
            invoiceNumber = "HL-712",
            customer = "أحمد محمود",
            invoiceDate = "2026-11-13",
            status = "partial",
            quantity = 64,
            totalAmount = "1280.00",
            paidAmount = "480.00",
            remainingAmount = "800.00",
            items = List(64) { index ->
                InvoiceItemDto(
                    productId = index.toLong() + 1,
                    name = "منتج تجريبي عربي Model ${index + 1}",
                    price = "20.00",
                    quantity = 1,
                    lineTotal = "20.00",
                )
            },
            notes = "ملاحظات عربية تمتد على أكثر من سطر\nتفاصيل الحساب",
        )
        val cache = InstrumentationRegistry.getInstrumentation().targetContext.cacheDir
        val file = File.createTempFile("invoice-test", ".pdf", cache)
        try {
            val bytes = renderInvoicePdf(invoice)
            assertTrue(bytes.decodeToString(endIndex = 5).startsWith("%PDF-"))
            file.writeBytes(bytes)
            val input = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
            PdfRenderer(input).use { renderer ->
                assertTrue(renderer.pageCount > 1)
                renderer.openPage(0).use { page ->
                    assertEquals(595, page.width)
                    assertEquals(842, page.height)
                }
            }
        } finally {
            file.delete()
        }
    }
}
