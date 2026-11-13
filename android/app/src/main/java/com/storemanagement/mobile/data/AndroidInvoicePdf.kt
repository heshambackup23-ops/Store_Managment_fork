package com.storemanagement.mobile.data

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextDirectionHeuristics
import android.text.TextPaint
import com.storemanagement.mobile.core.network.InvoiceDto
import java.io.ByteArrayOutputStream

private const val PAGE_WIDTH = 595
private const val PAGE_HEIGHT = 842
private const val MARGIN = 42
private const val CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN

internal fun renderInvoicePdf(invoice: InvoiceDto): ByteArray {
    val document = PdfDocument()
    try {
        InvoiceLayout(document, invoice).render()
        return ByteArrayOutputStream().use { output ->
            document.writeTo(output)
            output.toByteArray()
        }
    } finally {
        document.close()
    }
}

private class InvoiceLayout(
    private val document: PdfDocument,
    private val invoice: InvoiceDto,
) {
    private var pageNumber = 0
    private var page: PdfDocument.Page? = null
    private var top = MARGIN

    private val title = paint(23f, Color.rgb(17, 24, 39), bold = true)
    private val label = paint(13f, Color.rgb(26, 44, 52), bold = true)
    private val text = paint(12f, Color.rgb(29, 38, 46))
    private val muted = paint(11f, Color.rgb(66, 80, 90))
    private val line = paint(1f, Color.rgb(192, 201, 207))

    fun render() {
        newPage()
        try {
            block("التاريخ  " + isolate(invoice.invoiceDate))
            block("العميل  ${cleanText(invoice.customer)}")
            block("الحالة  ${statusLabel(invoice.status)}")
            top += 12
            block("أصناف الفاتورة", label)
            invoice.items.forEachIndexed { index, item ->
                val numbers = listOfNotNull(
                    item.quantity?.let { "الكمية ${isolate(it.toString())}" },
                    item.price?.let { "سعر الوحدة ${isolate(it)}" },
                    item.lineTotal?.let { "الإجمالي ${isolate(it)}" },
                ).joinToString("    ")
                val heading = "${isolate((index + 1).toString())}  ${cleanText(item.name.orEmpty())}"
                block(if (numbers.isEmpty()) heading else "$heading\n$numbers", text)
            }
            top += 12
            block("الإجمالي  ${isolate(invoice.totalAmount)} ج.م", label)
            block("المدفوع  ${isolate(invoice.paidAmount)} ج.م")
            block("المتبقي  ${isolate(invoice.remainingAmount)} ج.م")
            invoice.notes?.takeIf { it.isNotBlank() }?.let { notes ->
                top += 12
                block("ملاحظات", label)
                block(cleanText(notes))
            }
        } finally {
            finishPage()
        }
    }

    private fun newPage() {
        finishPage()
        pageNumber++
        page = document.startPage(PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, pageNumber).create())
        top = MARGIN
        block("فاتورة رقم ${isolate(invoice.invoiceNumber)}", title)
        canvas().drawLine(MARGIN.toFloat(), top.toFloat(), (PAGE_WIDTH - MARGIN).toFloat(), top.toFloat(), line)
        top += 14
    }

    private fun finishPage() {
        val current = page ?: return
        val footer = layout("صفحة ${isolate(pageNumber.toString())}", muted)
        draw(footer, PAGE_HEIGHT - MARGIN)
        document.finishPage(current)
        page = null
    }

    private fun block(content: String, style: TextPaint = text) {
        val layout = layout(content, style)
        var firstLine = 0
        while (firstLine < layout.lineCount) {
            val available = PAGE_HEIGHT - MARGIN * 2 - top
            val start = layout.getLineTop(firstLine)
            var endLine = firstLine
            while (endLine < layout.lineCount && layout.getLineBottom(endLine) - start <= available) {
                endLine++
            }
            if (endLine == firstLine) {
                newPage()
                continue
            }
            val height = layout.getLineBottom(endLine - 1) - start
            canvas().save()
            canvas().clipRect(MARGIN, top, PAGE_WIDTH - MARGIN, top + height)
            draw(layout, top - start)
            canvas().restore()
            top += height + 8
            firstLine = endLine
        }
    }

    private fun draw(layout: StaticLayout, y: Int) {
        canvas().save()
        canvas().translate(MARGIN.toFloat(), y.toFloat())
        layout.draw(canvas())
        canvas().restore()
    }

    private fun canvas(): Canvas = checkNotNull(page).canvas

    private fun layout(value: String, paint: TextPaint): StaticLayout {
        return StaticLayout.Builder.obtain(value, 0, value.length, paint, CONTENT_WIDTH)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setTextDirection(TextDirectionHeuristics.RTL)
            .setIncludePad(true)
            .build()
    }
}

private fun paint(size: Float, color: Int, bold: Boolean = false) = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
    textSize = size
    this.color = color
    typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
}

private fun cleanText(value: String) = value.filterNot { it in '\u202A'..'\u202E' || it in '\u2066'..'\u2069' }

private fun isolate(value: String) = "\u2066${cleanText(value)}\u2069"

private fun statusLabel(status: String): String = when (status) {
    "paid" -> "مدفوعة"
    "partial" -> "مدفوعة جزئيًا"
    "unpaid" -> "غير مدفوعة"
    "refunded" -> "مستردة"
    else -> cleanText(status)
}
