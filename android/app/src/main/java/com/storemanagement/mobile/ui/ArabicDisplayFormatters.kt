package com.storemanagement.mobile.ui

import java.text.SimpleDateFormat
import java.util.Locale

internal fun String.toArabicInvoiceStatus(): String = when (lowercase(Locale.ROOT)) {
    "paid" -> "مدفوعة"
    "unpaid" -> "غير مدفوعة"
    "partial", "partially_paid" -> "مدفوعة جزئياً"
    "refunded" -> "مستردة"
    else -> "حالة غير معروفة"
}

internal fun String.toArabicInstallmentStatus(): String = when (trim().lowercase(Locale.ROOT)) {
    "مكتمل", "complete", "completed" -> "مكتمل"
    "غير مكتمل", "pending", "incomplete" -> "غير مكتمل"
    "متأخر", "overdue" -> "متأخر"
    "مسترد", "refunded" -> "مسترد"
    else -> "حالة غير معروفة"
}

internal fun String.toArabicPersonalDebtStatus(): String = when (trim().lowercase(Locale.ROOT)) {
    "paid", "مسدد" -> "مسدد"
    "open", "مفتوح" -> "مفتوح"
    else -> "حالة غير معروفة"
}

internal fun String.toArabicDamagedStatus(): String = when (trim().lowercase(Locale.ROOT)) {
    "recorded" -> "مسجل"
    "voided" -> "ملغى"
    else -> "حالة غير معروفة"
}

internal fun String.toArabicDateDisplay(): String {
    val source = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { isLenient = false }
    val parsed = runCatching { source.parse(this) }.getOrNull() ?: return "تاريخ غير محدد"
    return SimpleDateFormat("d MMMM yyyy", Locale.forLanguageTag("ar")).format(parsed)
}

internal fun String.toArabicPermissionLabel(): String? {
    if (this == "api:me") return "بيانات الحساب"
    val parts = split('.')
    if (parts.size != 3 || parts[0] != "page") return null
    val module = when (parts[1]) {
        "products" -> "المنتجات"
        "categories" -> "التصنيفات"
        "customers" -> "العملاء"
        "invoices" -> "الفواتير"
        "suppliers" -> "الموردون"
        "installments" -> "الأقساط"
        "wallets" -> "المحافظ"
        "wallet_cashier" -> "صندوق المحافظ"
        "staff" -> "المستخدمون"
        "roles" -> "الأدوار"
        "profile" -> "الملف الشخصي"
        "damaged" -> "التالف"
        "maintenance" -> "الصيانة"
        "sales" -> "المبيعات"
        "cashier" -> "نقطة البيع"
        else -> "وحدة أخرى"
    }
    val action = when (parts[2]) {
        "view" -> "عرض"
        "manage" -> "إدارة"
        else -> return null
    }
    return "$module: $action"
}
