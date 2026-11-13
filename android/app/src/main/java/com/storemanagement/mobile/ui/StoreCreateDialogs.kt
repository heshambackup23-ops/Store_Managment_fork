package com.storemanagement.mobile.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.storemanagement.mobile.core.database.CachedProduct
import com.storemanagement.mobile.core.network.DamagedItemDto
import com.storemanagement.mobile.core.network.InstallmentInputDto
import com.storemanagement.mobile.core.network.InstallmentDto
import com.storemanagement.mobile.core.database.CachedCategory
import com.storemanagement.mobile.core.network.ProductInputDto
import com.storemanagement.mobile.core.network.SupplierInputDto
import com.storemanagement.mobile.core.network.SupplierDto
import com.storemanagement.mobile.core.network.WalletAdjustmentInputDto
import com.storemanagement.mobile.core.network.WalletDto
import com.storemanagement.mobile.core.network.WalletInputDto
import com.storemanagement.mobile.core.network.MaintenanceDto
import com.storemanagement.mobile.core.network.MaintenanceInputDto
import com.storemanagement.mobile.core.network.CashierWalletDto
import com.storemanagement.mobile.core.network.WalletCashierInputDto
import com.storemanagement.mobile.core.network.WalletCashierTransactionDto
import com.storemanagement.mobile.core.network.SettleWalletTransactionInputDto
import com.storemanagement.mobile.core.network.ReverseWalletTransactionInputDto
import com.storemanagement.mobile.core.network.PayAmountInputDto
import com.storemanagement.mobile.core.network.PersonalDebtDto
import com.storemanagement.mobile.core.network.PersonalDebtInputDto
import com.storemanagement.mobile.core.network.ProfileDto
import com.storemanagement.mobile.core.network.ProfileInputDto
import com.storemanagement.mobile.core.network.DamagedProductDto
import com.storemanagement.mobile.core.network.DamagedItemInputDto
import com.storemanagement.mobile.core.network.VoidDamagedItemInputDto
import java.util.UUID
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
internal fun ProductEditDialog(
    product: CachedProduct?,
    categories: List<CachedCategory>,
    onDismiss: () -> Unit,
    onSave: (Long?, ProductInputDto, String, Uri?) -> Unit,
) {
    var selectedImage by rememberSaveable(product?.id) { mutableStateOf<Uri?>(null) }
    val imagePicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) selectedImage = uri
    }
    var name by rememberSaveable(product?.id) { mutableStateOf(product?.name.orEmpty()) }
    var price by rememberSaveable(product?.id) { mutableStateOf(product?.price.orEmpty()) }
    var description by rememberSaveable(product?.id) { mutableStateOf(product?.description.orEmpty()) }
    var notes by rememberSaveable(product?.id) { mutableStateOf(product?.notes.orEmpty()) }
    var barcode by rememberSaveable(product?.id) { mutableStateOf(product?.barcode.orEmpty()) }
    val expectedStock by rememberSaveable(product?.id) { mutableStateOf<Int?>(product?.stock) }
    var stock by rememberSaveable(product?.id) { mutableStateOf(expectedStock?.toString() ?: "0") }
    var categoryId by rememberSaveable(product?.id) { mutableStateOf(product?.categoryId) }
    var categoryMenuOpen by remember { mutableStateOf(false) }
    var validationError by remember { mutableStateOf<String?>(null) }
    var requestKey by remember(product?.id) { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember(product?.id) { mutableStateOf<String?>(null) }

    fun payload(
        nextName: String = name,
        nextPrice: String = price,
        nextDescription: String = description,
        nextNotes: String = notes,
        nextBarcode: String = barcode,
        nextStock: String = stock,
        nextCategoryId: Long? = categoryId,
    ) = listOf(nextName, nextPrice, nextDescription, nextNotes, nextBarcode, nextStock, nextCategoryId).joinToString("\u0000")

    fun updatePayload(nextPayload: String) {
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (product == null) "إضافة منتج" else "تعديل المنتج") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    AsyncImage(
                        model = selectedImage ?: productImageModel(product?.imageUrl, product?.serverUpdatedAt),
                        contentDescription = "صورة المنتج",
                        modifier = Modifier.size(88.dp).clip(RoundedCornerShape(12.dp)),
                    )
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(if (selectedImage != null) "الصورة الجديدة" else if (product?.imageUrl != null) "الصورة الحالية" else "لا توجد صورة")
                        OutlinedButton(onClick = { imagePicker.launch("image/*") }) {
                            Icon(Icons.Filled.Image, contentDescription = null)
                            Text("اختيار صورة", modifier = Modifier.padding(start = 6.dp))
                        }
                        if (selectedImage != null) TextButton(onClick = { selectedImage = null }) { Text("إلغاء اختيار الصورة") }
                    }
                }
                OutlinedTextField(name, { updatePayload(payload(nextName = it)); name = it }, label = { Text("اسم المنتج") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    price,
                    { value -> val normalized = value.normalizeArabicDigits(); updatePayload(payload(nextPrice = normalized)); price = normalized },
                    label = { Text("السعر") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(description, { updatePayload(payload(nextDescription = it)); description = it }, label = { Text("الوصف (اختياري)") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(notes, { updatePayload(payload(nextNotes = it)); notes = it }, label = { Text("ملاحظات (اختياري)") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    barcode,
                    { updatePayload(payload(nextBarcode = it)); barcode = it },
                    label = { Text("الباركود (اختياري، إدخال يدوي)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    stock,
                    { value -> val normalized = value.normalizeArabicDigits().filter(Char::isDigit); updatePayload(payload(nextStock = normalized)); stock = normalized },
                    label = { Text("الكمية بالمخزون") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                androidx.compose.foundation.layout.Box {
                    OutlinedButton(onClick = { categoryMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(categories.firstOrNull { it.id == categoryId }?.name ?: "بدون تصنيف")
                    }
                    DropdownMenu(expanded = categoryMenuOpen, onDismissRequest = { categoryMenuOpen = false }) {
                        DropdownMenuItem(text = { Text("بدون تصنيف") }, onClick = { updatePayload(payload(nextCategoryId = null)); categoryId = null; categoryMenuOpen = false })
                        categories.forEach { category ->
                            DropdownMenuItem(text = { Text(category.name) }, onClick = { updatePayload(payload(nextCategoryId = category.id)); categoryId = category.id; categoryMenuOpen = false })
                        }
                    }
                }
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                val normalizedPrice = price.normalizeArabicDigits()
                val validPrice = normalizedPrice.toBigDecimalOrNull()?.let { it > java.math.BigDecimal.ZERO && it.scale().coerceAtMost(2) == it.scale() } == true
                if (name.isBlank() || !validPrice || stock.toIntOrNull() == null) {
                    validationError = "أدخل الاسم وسعراً صحيحاً وكمية مخزون صالحة."
                } else {
                    validationError = null
                    attemptedPayload = payload()
                    onSave(
                        product?.id,
                        ProductInputDto(
                            name = name.trim(),
                            price = normalizedPrice,
                            description = description.trim().ifBlank { null },
                            notes = notes.trim().ifBlank { null },
                            barcode = barcode.trim().ifBlank { null },
                            stock = stock.toInt(),
                            categoryId = categoryId,
                            expectedStock = expectedStock,
                        ),
                        requestKey,
                        selectedImage,
                    )
                }
            }) { Text(if (product == null) "حفظ المنتج" else "حفظ التعديلات") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
internal fun WalletCreateDialog(
    onDismiss: () -> Unit,
    onCreate: (WalletInputDto, String) -> Unit,
) {
    val providers = listOf(
        "vodafone_cash" to "فودافون كاش",
        "instapay" to "إنستا باي",
        "orange_cash" to "أورنج كاش",
        "etisalat_cash" to "اتصالات كاش",
        "we_pay" to "WE Pay",
        "other" to "أخرى",
    )
    var name by rememberSaveable { mutableStateOf("") }
    var provider by rememberSaveable { mutableStateOf(providers.first().first) }
    var identifier by rememberSaveable { mutableStateOf("") }
    var openingBalance by rememberSaveable { mutableStateOf("0.00") }
    var menuOpen by remember { mutableStateOf(false) }
    var validationError by remember { mutableStateOf<String?>(null) }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember { mutableStateOf<String?>(null) }

    fun payload(nextName: String = name, nextProvider: String = provider, nextIdentifier: String = identifier, nextOpening: String = openingBalance) =
        listOf(nextName, nextProvider, nextIdentifier, nextOpening).joinToString("\u0000")

    fun updatePayload(nextPayload: String) {
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("إضافة محفظة") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(name, { updatePayload(payload(nextName = it)); name = it }, label = { Text("اسم المحفظة") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                androidx.compose.foundation.layout.Box {
                    OutlinedButton(onClick = { menuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(providers.first { it.first == provider }.second)
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        providers.forEach { (key, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { updatePayload(payload(nextProvider = key)); provider = key; menuOpen = false }) }
                    }
                }
                OutlinedTextField(identifier, { updatePayload(payload(nextIdentifier = it)); identifier = it }, label = { Text("رقم المحفظة (اختياري)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    openingBalance,
                    { value -> val normalized = value.normalizeArabicDigits(); updatePayload(payload(nextOpening = normalized)); openingBalance = normalized },
                    label = { Text("الرصيد الافتتاحي") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                if (name.isBlank() || !openingBalance.isValidPaidAmount()) {
                    validationError = "أدخل اسم المحفظة ورصيداً افتتاحياً صحيحاً."
                } else {
                    attemptedPayload = payload()
                    onCreate(WalletInputDto(name.trim(), provider, identifier.trim().ifBlank { null }, openingBalance), requestKey)
                }
            }) { Text("حفظ المحفظة") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
internal fun WalletAdjustmentDialog(
    wallet: WalletDto,
    onDismiss: () -> Unit,
    onAdjust: (WalletAdjustmentInputDto, String) -> Unit,
) {
    var amount by rememberSaveable(wallet.id) { mutableStateOf("") }
    var reason by rememberSaveable(wallet.id) { mutableStateOf("") }
    var validationError by remember { mutableStateOf<String?>(null) }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember { mutableStateOf<String?>(null) }

    fun updatePayload(nextAmount: String = amount, nextReason: String = reason) {
        val nextPayload = "$nextAmount\u0000$nextReason"
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تسوية ${wallet.name}") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 480.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("استخدم قيمة موجبة للإضافة أو سالبة للخصم من الرصيد.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(
                    amount,
                    { value -> val normalized = value.normalizeArabicDigits(); updatePayload(nextAmount = normalized); amount = normalized },
                    label = { Text("مبلغ التسوية") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(reason, { updatePayload(nextReason = it); reason = it }, label = { Text("سبب التسوية") }, modifier = Modifier.fillMaxWidth())
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                if (!amount.isValidSignedAmount() || reason.trim().length < 3) {
                    validationError = "أدخل مبلغاً غير صفري وسبباً من ثلاثة أحرف على الأقل."
                } else {
                    attemptedPayload = "$amount\u0000$reason"
                    onAdjust(WalletAdjustmentInputDto(amount, reason.trim()), requestKey)
                }
            }) { Text("تسجيل التسوية") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
internal fun SupplierCreateDialog(
    supplier: SupplierDto? = null,
    onDismiss: () -> Unit,
    onSave: (Long?, SupplierInputDto, String) -> Unit,
) {
    var name by rememberSaveable(supplier?.id) { mutableStateOf(supplier?.name.orEmpty()) }
    var phone by rememberSaveable(supplier?.id) { mutableStateOf(supplier?.phone.orEmpty()) }
    var email by rememberSaveable(supplier?.id) { mutableStateOf(supplier?.email.orEmpty()) }
    var address by rememberSaveable(supplier?.id) { mutableStateOf(supplier?.address.orEmpty()) }
    var openingBalance by rememberSaveable(supplier?.id) { mutableStateOf(supplier?.openingBalance ?: "0.00") }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember { mutableStateOf<String?>(null) }
    var validationError by remember { mutableStateOf<String?>(null) }

    fun payload(
        nextName: String = name,
        nextPhone: String = phone,
        nextEmail: String = email,
        nextAddress: String = address,
        nextOpening: String = openingBalance,
    ) = listOf(nextName, nextPhone, nextEmail, nextAddress, nextOpening).joinToString("\u0000")

    fun preparePayload(nextPayload: String) {
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (supplier == null) "إضافة مورد" else "تعديل بيانات المورد") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(
                    name,
                    { preparePayload(payload(nextName = it)); name = it },
                    label = { Text("اسم المورد") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    phone,
                    { preparePayload(payload(nextPhone = it)); phone = it },
                    label = { Text("الهاتف") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    email,
                    { preparePayload(payload(nextEmail = it)); email = it },
                    label = { Text("البريد الإلكتروني") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    address,
                    { preparePayload(payload(nextAddress = it)); address = it },
                    label = { Text("العنوان") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    openingBalance,
                    { value ->
                        val normalized = value.normalizeArabicDigits()
                        preparePayload(payload(nextOpening = normalized))
                        openingBalance = normalized
                    },
                    label = { Text("الرصيد الافتتاحي") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text(
                    "سيُسجل الرصيد الافتتاحي كما هو في حساب المورد.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                val normalizedEmail = email.trim()
                if (
                    name.isBlank() ||
                    (normalizedEmail.isNotBlank() && !android.util.Patterns.EMAIL_ADDRESS.matcher(normalizedEmail).matches()) ||
                    !openingBalance.isValidPaidAmount()
                ) {
                    validationError = "أدخل اسم المورد وبريداً صحيحاً ورصيداً افتتاحياً غير سالب بمنزلتين عشريتين."
                } else {
                    validationError = null
                    attemptedPayload = payload()
                    onSave(
                        supplier?.id,
                        SupplierInputDto(
                            name = name.trim(),
                            phone = phone.trim().ifBlank { null },
                            email = normalizedEmail.ifBlank { null },
                            address = address.trim().ifBlank { null },
                            openingBalance = openingBalance,
                        ),
                        requestKey,
                    )
                }
            }) { Text(if (supplier == null) "حفظ المورد" else "حفظ التعديلات") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
internal fun InstallmentCreateDialog(
    products: List<CachedProduct>,
    canSelectProducts: Boolean,
    record: InstallmentDto? = null,
    onDismiss: () -> Unit,
    onSave: (Long?, InstallmentInputDto, String) -> Unit,
) {
    var customer by rememberSaveable(record?.id) { mutableStateOf(record?.customer.orEmpty()) }
    var paymentDate by rememberSaveable(record?.id) { mutableStateOf(record?.paymentDate.orEmpty()) }
    var nextPaymentDate by rememberSaveable(record?.id) { mutableStateOf(record?.nextPaymentDate.orEmpty()) }
    var paidAmount by rememberSaveable(record?.id) { mutableStateOf(record?.paidAmount ?: "0.00") }
    var notes by rememberSaveable { mutableStateOf("") }
    var productFilter by rememberSaveable { mutableStateOf("") }
    var customEntry by rememberSaveable(record?.id) { mutableStateOf(record?.productId == null || !canSelectProducts) }
    var customProductName by rememberSaveable(record?.id) { mutableStateOf(record?.productName.orEmpty()) }
    var totalAmount by rememberSaveable(record?.id) { mutableStateOf(record?.productPrice.orEmpty()) }
    var selectedIds by remember(record) {
        mutableStateOf(
            record?.items.orEmpty().mapNotNull { it.productId }.toSet()
                .ifEmpty { record?.productId?.let(::setOf).orEmpty() },
        )
    }
    var quantities by remember(record) {
        mutableStateOf(record?.items.orEmpty().mapNotNull { item ->
            item.productId?.let { it to (item.quantity ?: 1).toString() }
        }.toMap().ifEmpty { record?.productId?.let { mapOf(it to record.quantity.toString()) }.orEmpty() })
    }
    var requestKey by remember(record?.id) { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember(record?.id) { mutableStateOf<String?>(null) }
    var validationError by remember(record?.id) { mutableStateOf<String?>(null) }

    fun payload(
        nextCustomer: String = customer,
        nextPaymentDate: String = paymentDate,
        nextNextPaymentDate: String = nextPaymentDate,
        nextPaidAmount: String = paidAmount,
        nextNotes: String = notes,
        nextCustomEntry: Boolean = customEntry,
        nextProductName: String = customProductName,
        nextTotalAmount: String = totalAmount,
        nextIds: Set<Long> = selectedIds,
        nextQuantities: Map<Long, String> = quantities,
    ) = listOf(
        nextCustomer,
        nextPaymentDate,
        nextNextPaymentDate,
        nextPaidAmount,
        nextNotes,
        nextCustomEntry.toString(),
        nextProductName,
        nextTotalAmount,
        nextIds.sorted().joinToString(","),
        nextIds.sorted().joinToString(",") { nextQuantities[it].orEmpty() },
    ).joinToString("\u0000")

    fun rotateKeyIfChanged(nextPayload: String) {
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    val visibleProducts = remember(products, productFilter) {
        products.filter { product ->
            productFilter.isBlank() ||
                product.name.contains(productFilter, true) ||
                product.barcode.orEmpty().contains(productFilter, true)
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (record == null) "إضافة دين" else "تعديل الدين") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 560.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(
                    customer,
                    { rotateKeyIfChanged(payload(nextCustomer = it)); customer = it },
                    label = { Text("اسم العميل") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                DatePickerField(paymentDate, "تاريخ الدفع (اختياري)", { value -> rotateKeyIfChanged(payload(nextPaymentDate = value)); paymentDate = value }, Modifier.fillMaxWidth(), nullable = true)
                DatePickerField(nextPaymentDate, "موعد الدفعة التالية (اختياري)", { value -> rotateKeyIfChanged(payload(nextNextPaymentDate = value)); nextPaymentDate = value }, Modifier.fillMaxWidth(), nullable = true)
                OutlinedTextField(
                    paidAmount,
                    { value ->
                        val normalized = value.normalizeArabicDigits()
                        rotateKeyIfChanged(payload(nextPaidAmount = normalized))
                        paidAmount = normalized
                    },
                    label = { Text("المبلغ المدفوع") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    notes,
                    { rotateKeyIfChanged(payload(nextNotes = it)); notes = it },
                    label = { Text("ملاحظات") },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (canSelectProducts) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = !customEntry,
                            onClick = { rotateKeyIfChanged(payload(nextCustomEntry = false)); customEntry = false },
                            label = { Text("اختيار منتجات") },
                        )
                        FilterChip(
                            selected = customEntry,
                            onClick = { rotateKeyIfChanged(payload(nextCustomEntry = true)); customEntry = true },
                            label = { Text("إدخال يدوي") },
                        )
                    }
                }
                if (customEntry) {
                    OutlinedTextField(
                        customProductName,
                        { rotateKeyIfChanged(payload(nextProductName = it)); customProductName = it },
                        label = { Text("وصف الدين أو المنتج") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        totalAmount,
                        { value ->
                            val normalized = value.normalizeArabicDigits()
                            rotateKeyIfChanged(payload(nextTotalAmount = normalized))
                            totalAmount = normalized
                        },
                        label = { Text("إجمالي الدين") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    Text("المنتجات", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Text(
                        "يُحسب الدين من الأسعار الحالية في الخادم ولا يغيّر المخزون.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    OutlinedTextField(
                        productFilter,
                        { productFilter = it },
                        label = { Text("بحث بالاسم أو الرمز") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (visibleProducts.isEmpty()) {
                        Text("لا توجد منتجات متاحة. تحقق من الاتصال.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } else {
                        visibleProducts.forEach { product ->
                            val checked = product.id in selectedIds
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = checked,
                                    onCheckedChange = { selected ->
                                        val nextIds = if (selected) selectedIds + product.id else selectedIds - product.id
                                        val nextQuantities = if (selected) quantities + (product.id to (quantities[product.id] ?: "1")) else quantities
                                        rotateKeyIfChanged(payload(nextIds = nextIds, nextQuantities = nextQuantities))
                                        selectedIds = nextIds
                                        quantities = nextQuantities
                                    },
                                )
                                Column(Modifier.weight(1f)) {
                                    Text(product.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(product.price, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (checked) {
                                    OutlinedTextField(
                                        quantities[product.id] ?: "1",
                                        { value ->
                                            val updated = quantities + (product.id to value.normalizeArabicDigits().filter(Char::isDigit))
                                            rotateKeyIfChanged(payload(nextQuantities = updated))
                                            quantities = updated
                                        },
                                        label = { Text("الكمية") },
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                        singleLine = true,
                                        modifier = Modifier.width(84.dp),
                                    )
                                }
                            }
                        }
                    }
                }
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                val validQuantities = selectedIds.mapNotNull { quantities[it]?.toIntOrNull() }
                val datesAreValid = (paymentDate.isBlank() || paymentDate.isValidInvoiceDate()) &&
                    (nextPaymentDate.isBlank() || nextPaymentDate.isValidInvoiceDate())
                val enteredTotal = totalAmount.normalizeArabicDigits().toBigDecimalOrNull()
                val enteredPaid = paidAmount.normalizeArabicDigits().toBigDecimalOrNull()
                val validCustomTotal = enteredTotal != null && enteredTotal > java.math.BigDecimal.ZERO &&
                    enteredTotal <= java.math.BigDecimal("99999999")
                val selectedTotal = selectedIds.sumOf { id ->
                    val productPrice = products.firstOrNull { it.id == id }?.price?.toBigDecimalOrNull() ?: java.math.BigDecimal.ZERO
                    productPrice.multiply(java.math.BigDecimal(quantities[id]?.toIntOrNull() ?: 0))
                }
                val currentTotal = if (customEntry) enteredTotal else selectedTotal
                val priceMissing = !customEntry && selectedIds.any { id ->
                    products.firstOrNull { it.id == id }?.price?.toBigDecimalOrNull() == null
                }
                val formError = when {
                    customer.isBlank() -> "أدخل اسم العميل."
                    !datesAreValid -> "تحقق من صيغة التاريخ: سنة-شهر-يوم."
                    !paidAmount.isValidPaidAmount() || enteredPaid == null -> "أدخل مبلغاً مدفوعاً غير سالب وبحد أقصى منزلتين عشريتين."
                    customEntry && customProductName.isBlank() -> "أدخل وصف الدين أو المنتج."
                    customEntry && (!totalAmount.isValidPaidAmount() || !validCustomTotal) -> "أدخل إجمالي دين أكبر من صفر وبحد أقصى منزلتين عشريتين."
                    !customEntry && selectedIds.isEmpty() -> "اختر منتجاً واحداً على الأقل أو بدّل إلى الإدخال اليدوي."
                    !customEntry && (validQuantities.size != selectedIds.size || validQuantities.any { it <= 0 }) -> "أدخل كمية موجبة لكل منتج محدد."
                    priceMissing -> "تعذر قراءة سعر أحد المنتجات. حدّث قائمة المنتجات ثم أعد المحاولة."
                    currentTotal == null -> "أدخل إجمالي الدين أو اختر منتجات صالحة."
                    enteredPaid > currentTotal -> "المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الدين."
                    else -> null
                }
                if (formError != null) {
                    validationError = formError
                } else {
                    validationError = null
                    attemptedPayload = payload()
                    val productIds = selectedIds.sorted()
                    onSave(
                        record?.id,
                        InstallmentInputDto(
                            customer = customer.trim(),
                            productIds = if (customEntry) null else productIds,
                            quantities = if (customEntry) null else productIds.map { quantities.getValue(it).toInt() },
                            productName = customProductName.trim().takeIf { customEntry },
                            totalAmount = totalAmount.takeIf { customEntry },
                            paymentDate = paymentDate.ifBlank { null },
                            nextPaymentDate = nextPaymentDate.ifBlank { null },
                            paidAmount = paidAmount,
                            notes = notes.ifBlank { null },
                        ),
                        requestKey,
                    )
                }
            }) { Text(if (record == null) "حفظ الدين" else "حفظ التعديلات") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
internal fun MaintenanceEditDialog(
    record: MaintenanceDto?,
    hilal: Boolean,
    onDismiss: () -> Unit,
    onSave: (MaintenanceInputDto, String) -> Unit,
) {
    val statuses = maintenanceStatusOptions(record, hilal)
    var name by rememberSaveable(record?.id) { mutableStateOf(record?.name.orEmpty()) }
    var owner by rememberSaveable(record?.id) { mutableStateOf(record?.owner.orEmpty()) }
    var phone by rememberSaveable(record?.id) { mutableStateOf(record?.phone.orEmpty()) }
    var address by rememberSaveable(record?.id) { mutableStateOf(record?.address.orEmpty()) }
    var description by rememberSaveable(record?.id) { mutableStateOf(record?.description.orEmpty()) }
    var status by rememberSaveable(record?.id) { mutableStateOf(record?.status ?: "قيد الصيانة") }
    var requestedDate by rememberSaveable(record?.id) {
        mutableStateOf(record?.requestedDate ?: SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()))
    }
    var statusMenuOpen by remember { mutableStateOf(false) }
    var validationError by remember { mutableStateOf<String?>(null) }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember { mutableStateOf<String?>(null) }

    fun payload(
        nextName: String = name,
        nextOwner: String = owner,
        nextPhone: String = phone,
        nextAddress: String = address,
        nextDescription: String = description,
        nextStatus: String = status,
        nextDate: String = requestedDate,
    ) = listOf(nextName, nextOwner, nextPhone, nextAddress, nextDescription, nextStatus, nextDate).joinToString("\u0000")

    fun updatePayload(nextPayload: String) {
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (record == null) "إضافة طلب صيانة" else "تعديل طلب الصيانة") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 560.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(name, { updatePayload(payload(nextName = it)); name = it }, label = { Text("نوع الجهاز أو الخدمة") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(owner, { updatePayload(payload(nextOwner = it)); owner = it }, label = { Text("اسم العميل") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(phone, { updatePayload(payload(nextPhone = it)); phone = it }, label = { Text("الهاتف (اختياري)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(address, { updatePayload(payload(nextAddress = it)); address = it }, label = { Text("العنوان (اختياري)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(description, { updatePayload(payload(nextDescription = it)); description = it }, label = { Text("الوصف (اختياري)") }, modifier = Modifier.fillMaxWidth())
                DatePickerField(requestedDate, "تاريخ الاستلام", { value -> updatePayload(payload(nextDate = value)); requestedDate = value }, Modifier.fillMaxWidth())
                androidx.compose.foundation.layout.Box {
                    OutlinedButton(onClick = { statusMenuOpen = true }, modifier = Modifier.fillMaxWidth()) { Text(status) }
                    DropdownMenu(expanded = statusMenuOpen, onDismissRequest = { statusMenuOpen = false }) {
                        statuses.forEach { option ->
                            DropdownMenuItem(
                                text = { Text(option) },
                                onClick = { updatePayload(payload(nextStatus = option)); status = option; statusMenuOpen = false },
                            )
                        }
                    }
                }
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                if (name.isBlank() || owner.isBlank() || !requestedDate.isValidInvoiceDate()) {
                    validationError = "أدخل نوع الجهاز واسم العميل وتاريخاً صحيحاً."
                } else {
                    attemptedPayload = payload()
                    onSave(
                        MaintenanceInputDto(
                            name = name.trim(),
                            owner = owner.trim(),
                            phone = phone.trim().ifBlank { null },
                            address = address.trim().ifBlank { null },
                            description = description.trim().ifBlank { null },
                            status = status,
                            requestedDate = requestedDate,
                        ),
                        requestKey,
                    )
                }
            }) { Text("حفظ") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
internal fun WalletCashierCreateDialog(
    wallets: List<CashierWalletDto>,
    onDismiss: () -> Unit,
    onCreate: (WalletCashierInputDto, String) -> Unit,
) {
    var walletId by remember(wallets) { mutableStateOf(wallets.firstOrNull()?.id) }
    var type by rememberSaveable { mutableStateOf("send") }
    var amount by rememberSaveable { mutableStateOf("") }
    var counterparty by rememberSaveable { mutableStateOf("") }
    var commission by rememberSaveable { mutableStateOf("") }
    var fee by rememberSaveable { mutableStateOf("") }
    var paymentMethod by rememberSaveable { mutableStateOf("cash") }
    var customerName by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var walletMenuOpen by remember { mutableStateOf(false) }
    var validationError by remember { mutableStateOf<String?>(null) }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember { mutableStateOf<String?>(null) }

    fun payload(
        nextWalletId: Long? = walletId,
        nextType: String = type,
        nextAmount: String = amount,
        nextCounterparty: String = counterparty,
        nextCommission: String = commission,
        nextFee: String = fee,
        nextPaymentMethod: String = paymentMethod,
        nextCustomerName: String = customerName,
        nextNotes: String = notes,
    ) = listOf(nextWalletId, nextType, nextAmount, nextCounterparty, nextCommission, nextFee, nextPaymentMethod, nextCustomerName, nextNotes).joinToString("\u0000")

    fun updatePayload(nextPayload: String) {
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    val selectedWallet = wallets.firstOrNull { it.id == walletId }
    val defaultCommission = calculateWalletCharge(
        amount,
        selectedWallet?.defaultCommissionPercent,
        selectedWallet?.defaultCommissionMin,
    )
    val defaultFee = calculateWalletCharge(
        amount,
        selectedWallet?.defaultFeePercent,
        selectedWallet?.defaultFeeMin,
        selectedWallet?.defaultFeeMax,
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تسجيل معاملة محفظة") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 560.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (wallets.isEmpty()) Text("لا توجد محفظة نشطة متاحة. فعّل أو أضف محفظة أولاً.", color = MaterialTheme.colorScheme.error)
                else {
                    androidx.compose.foundation.layout.Box {
                        OutlinedButton(onClick = { walletMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                            val selected = wallets.firstOrNull { it.id == walletId }
                            Text(selected?.let { "${it.name} · ${it.balance} ج.م" } ?: "اختر المحفظة")
                        }
                        DropdownMenu(expanded = walletMenuOpen, onDismissRequest = { walletMenuOpen = false }) {
                            wallets.forEach { wallet ->
                                DropdownMenuItem(
                                    text = { Text("${wallet.name} · ${wallet.balance} ج.م") },
                                    onClick = { updatePayload(payload(nextWalletId = wallet.id)); walletId = wallet.id; walletMenuOpen = false },
                                )
                            }
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = type == "send", onClick = { updatePayload(payload(nextType = "send")); type = "send" }, label = { Text("تحويل") })
                    FilterChip(selected = type == "receive", onClick = { updatePayload(payload(nextType = "receive")); type = "receive" }, label = { Text("استلام") })
                }
                OutlinedTextField(
                    amount,
                    { value -> val normalized = value.normalizeArabicDigits(); updatePayload(payload(nextAmount = normalized)); amount = normalized },
                    label = { Text("المبلغ") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    counterparty,
                    { value -> updatePayload(payload(nextCounterparty = value)); counterparty = value },
                    label = { Text("رقم الطرف الآخر أو إنستا باي") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (selectedWallet != null && amount.isNotBlank()) {
                    Text(
                        "الافتراضي: عمولة ${defaultCommission ?: "0.00"} ج.م · رسوم ${defaultFee ?: "0.00"} ج.م",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedTextField(
                    commission,
                    { value -> val normalized = value.normalizeArabicDigits(); updatePayload(payload(nextCommission = normalized)); commission = normalized },
                    label = { Text("العمولة (اختياري)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    fee,
                    { value -> val normalized = value.normalizeArabicDigits(); updatePayload(payload(nextFee = normalized)); fee = normalized },
                    label = { Text("رسوم المزود (اختياري)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (type == "send") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(selected = paymentMethod == "cash", onClick = { updatePayload(payload(nextPaymentMethod = "cash")); paymentMethod = "cash" }, label = { Text("نقدي") })
                        FilterChip(selected = paymentMethod == "deferred", onClick = { updatePayload(payload(nextPaymentMethod = "deferred")); paymentMethod = "deferred" }, label = { Text("آجل") })
                    }
                    if (paymentMethod == "deferred") {
                        OutlinedTextField(
                            customerName,
                            { updatePayload(payload(nextCustomerName = it)); customerName = it },
                            label = { Text("اسم العميل للآجل") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                OutlinedTextField(notes, { updatePayload(payload(nextNotes = it)); notes = it }, label = { Text("ملاحظات (اختياري)") }, modifier = Modifier.fillMaxWidth())
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = {
                val enteredAmount = amount.normalizeArabicDigits().toBigDecimalOrNull()
                val optionalMoneyIsValid = listOf(commission, fee).all { it.isBlank() || it.isValidPaidAmount() }
                if (
                    walletId == null || enteredAmount == null || enteredAmount <= java.math.BigDecimal.ZERO ||
                    counterparty.isBlank() || !optionalMoneyIsValid ||
                    (type == "send" && paymentMethod == "deferred" && customerName.isBlank())
                ) {
                    validationError = "أدخل المحفظة والمبلغ ورقم الطرف الآخر وبيانات الآجل إن لزم."
                } else {
                    attemptedPayload = payload()
                    val appliedCommission = commission.normalizeArabicDigits().ifBlank { defaultCommission.orEmpty() }.ifBlank { null }
                    val appliedFee = fee.normalizeArabicDigits().ifBlank { defaultFee.orEmpty() }.ifBlank { null }
                    onCreate(
                        WalletCashierInputDto(
                            walletId = walletId!!,
                            type = type,
                            amount = amount.normalizeArabicDigits(),
                            counterparty = counterparty.trim(),
                            commission = appliedCommission,
                            fee = appliedFee,
                            paymentMethod = paymentMethod.takeIf { type == "send" },
                            customerName = customerName.trim().ifBlank { null },
                            notes = notes.trim().ifBlank { null },
                        ),
                        requestKey,
                    )
                }
            }, enabled = wallets.isNotEmpty() && !LocalIsSaving.current) { Text("تسجيل") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

private fun calculateWalletCharge(
    amount: String,
    percentage: String?,
    minimum: String?,
    maximum: String? = null,
): String? {
    val principal = amount.normalizeArabicDigits().toBigDecimalOrNull() ?: return null
    val rate = percentage?.toBigDecimalOrNull() ?: java.math.BigDecimal.ZERO
    val floor = minimum?.toBigDecimalOrNull() ?: java.math.BigDecimal.ZERO
    val ceiling = maximum?.toBigDecimalOrNull()
    var charge = principal.multiply(rate).divide(java.math.BigDecimal("100"), 2, java.math.RoundingMode.HALF_UP)
        .max(floor)
    if (ceiling != null) charge = charge.min(ceiling)
    return charge.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()
}

@Composable
internal fun WalletCashierActionDialog(
    transaction: WalletCashierTransactionDto,
    action: CashierAction,
    onDismiss: () -> Unit,
    onSettle: (SettleWalletTransactionInputDto, String) -> Unit,
    onReverse: (ReverseWalletTransactionInputDto, String) -> Unit,
) {
    var amount by rememberSaveable(transaction.uuid) { mutableStateOf("") }
    var reason by rememberSaveable(transaction.uuid) { mutableStateOf("") }
    var validationError by remember { mutableStateOf<String?>(null) }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember { mutableStateOf<String?>(null) }

    fun updatePayload(nextAmount: String = amount, nextReason: String = reason) {
        val nextPayload = "$nextAmount\u0000$nextReason"
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (action == CashierAction.Settle) "تحصيل المبلغ الآجل" else "عكس المعاملة") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("${transaction.amount} ج.م · ${transaction.customerName.orEmpty()}")
                if (action == CashierAction.Settle) {
                    Text("المتبقي ${transaction.receivable} ج.م. اترك المبلغ فارغاً للتحصيل الكامل.", style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(
                        amount,
                        { value -> val normalized = value.normalizeArabicDigits(); updatePayload(nextAmount = normalized); amount = normalized },
                        label = { Text("مبلغ التحصيل (اختياري)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                } else {
                    Text("سيُضاف قيد عكسي؛ لن يُحذف السجل الأصلي.", style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(reason, { updatePayload(nextReason = it); reason = it }, label = { Text("سبب العكس") }, modifier = Modifier.fillMaxWidth())
                }
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                if (action == CashierAction.Settle) {
                    if (amount.isNotBlank() && !amount.isValidPaidAmount()) validationError = "أدخل مبلغ تحصيل صحيحاً."
                    else {
                        attemptedPayload = "$amount\u0000$reason"
                        onSettle(SettleWalletTransactionInputDto(amount.normalizeArabicDigits().ifBlank { null }), requestKey)
                    }
                } else if (reason.trim().length < 3) {
                    validationError = "اكتب سبباً من ثلاثة أحرف على الأقل."
                } else {
                    attemptedPayload = "$amount\u0000$reason"
                    onReverse(ReverseWalletTransactionInputDto(reason.trim()), requestKey)
                }
            }) { Text(if (action == CashierAction.Settle) "تحصيل" else "عكس المعاملة") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
internal fun PaymentAmountDialog(
    title: String,
    remaining: String,
    onDismiss: () -> Unit,
    onPay: (PayAmountInputDto, String) -> Unit,
    requireAmount: Boolean = false,
) {
    var amount by rememberSaveable(title) { mutableStateOf("") }
    var validationError by remember { mutableStateOf<String?>(null) }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedAmount by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            DialogForm(maxHeight = 420.dp) {
                Text(
                    if (requireAmount) "المتبقي ${remaining} ج.م. أدخل مبلغ الدفعة."
                    else "المتبقي ${remaining} ج.م. اترك المبلغ فارغاً لتسجيله كاملاً.",
                )
                OutlinedTextField(
                    amount,
                    { value ->
                        val normalized = value.normalizeArabicDigits()
                        if (attemptedAmount != null && attemptedAmount != normalized) {
                            requestKey = UUID.randomUUID().toString()
                            attemptedAmount = null
                        }
                        amount = normalized
                    },
                    label = { Text(if (requireAmount) "مبلغ الدفعة" else "مبلغ الدفعة (اختياري)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                val entered = amount.toBigDecimalOrNull()
                val balance = remaining.toBigDecimalOrNull()
                when {
                    requireAmount && amount.isBlank() -> validationError = "أدخل مبلغ الدفعة."
                    amount.isNotBlank() && !amount.isValidPaidAmount() -> validationError = "أدخل مبلغاً صحيحاً بمنزلتين عشريتين كحد أقصى."
                    entered != null && entered <= java.math.BigDecimal.ZERO -> validationError = "يجب أن تكون الدفعة أكبر من صفر."
                    entered != null && balance != null && entered > balance -> validationError = "لا يمكن أن تتجاوز الدفعة المبلغ المتبقي."
                    else -> {
                        validationError = null
                        attemptedAmount = amount
                        onPay(PayAmountInputDto(amount.ifBlank { null }), requestKey)
                    }
                }
            }) { Text("تأكيد الدفعة") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
internal fun ProfileEditDialog(
    profile: ProfileDto?,
    onDismiss: () -> Unit,
    onSave: (ProfileInputDto) -> Unit,
) {
    var name by rememberSaveable(profile?.id) { mutableStateOf(profile?.name.orEmpty()) }
    var email by rememberSaveable(profile?.id) { mutableStateOf(profile?.email.orEmpty()) }
    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }
    var validationError by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تعديل الحساب") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 420.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(name, { name = it }, label = { Text("الاسم") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(email, { email = it }, label = { Text("البريد الإلكتروني (اختياري)") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("تغيير كلمة المرور (اتركه فارغاً إن لم ترغب بالتغيير)", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(currentPassword, { currentPassword = it }, label = { Text("كلمة المرور الحالية") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(newPassword, { newPassword = it }, label = { Text("كلمة المرور الجديدة (8 أحرف على الأقل)") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(confirmPassword, { confirmPassword = it }, label = { Text("تأكيد كلمة المرور الجديدة") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), singleLine = true, modifier = Modifier.fillMaxWidth())
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = {
                val cleanEmail = email.trim()
                if (name.isBlank()) validationError = "أدخل الاسم."
                else if (cleanEmail.isNotBlank() && !android.util.Patterns.EMAIL_ADDRESS.matcher(cleanEmail).matches()) {
                    validationError = "أدخل بريداً إلكترونياً صحيحاً أو اتركه فارغاً."
                } else if (newPassword.isNotEmpty() && currentPassword.isEmpty()) {
                    validationError = "أدخل كلمة المرور الحالية لتغييرها."
                } else if (newPassword.isNotEmpty() && newPassword.length < 8) {
                    validationError = "كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف."
                } else if (newPassword != confirmPassword) {
                    validationError = "تأكيد كلمة المرور غير مطابق."
                } else {
                    validationError = null
                    onSave(
                        ProfileInputDto(
                            name = name.trim(),
                            email = cleanEmail.ifBlank { null },
                            currentPassword = currentPassword.takeIf { it.isNotEmpty() },
                            password = newPassword.takeIf { it.isNotEmpty() },
                            passwordConfirmation = confirmPassword.takeIf { it.isNotEmpty() },
                        ),
                    )
                }
            }, enabled = profile != null && !LocalIsSaving.current) { Text("حفظ") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
internal fun DamagedItemCreateDialog(
    products: List<DamagedProductDto>,
    isLoading: Boolean,
    error: String?,
    onSearch: (String) -> Unit,
    onDismiss: () -> Unit,
    onCreate: (DamagedItemInputDto, String) -> Unit,
) {
    val reasons = listOf(
        "broken" to "كسر",
        "water" to "تلف بالمياه",
        "defective" to "عيب تصنيع",
        "not_working" to "لا يعمل",
        "lost" to "فقد / سرقة",
        "expired" to "منتهي الصلاحية",
        "returned" to "مرتجع تالف",
        "other" to "أخرى",
    )
    var productId by rememberSaveable { mutableStateOf<Long?>(null) }
    var quantity by rememberSaveable { mutableStateOf("1") }
    var reason by rememberSaveable { mutableStateOf("broken") }
    var unitValue by rememberSaveable { mutableStateOf("") }
    var damagedOn by rememberSaveable { mutableStateOf(SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())) }
    var notes by rememberSaveable { mutableStateOf("") }
    var search by rememberSaveable { mutableStateOf("") }
    var productMenuOpen by remember { mutableStateOf(false) }
    var reasonMenuOpen by remember { mutableStateOf(false) }
    var validationError by remember { mutableStateOf<String?>(null) }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember { mutableStateOf<String?>(null) }
    val selectedProduct = products.firstOrNull { it.id == productId }

    fun payload(
        nextProductId: Long? = productId,
        nextQuantity: String = quantity,
        nextReason: String = reason,
        nextUnitValue: String = unitValue,
        nextDamagedOn: String = damagedOn,
        nextNotes: String = notes,
    ) = listOf(nextProductId, nextQuantity, nextReason, nextUnitValue, nextDamagedOn, nextNotes).joinToString("\u0000")

    fun updatePayload(nextPayload: String) {
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تسجيل هالك") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 560.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(
                    search,
                    { search = it; onSearch(it) },
                    label = { Text("بحث عن المنتج أو الباركود") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                androidx.compose.foundation.layout.Box {
                    OutlinedButton(onClick = { productMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(selectedProduct?.let { "${it.name} · المخزون ${it.stock}" } ?: "اختر المنتج")
                    }
                    DropdownMenu(expanded = productMenuOpen, onDismissRequest = { productMenuOpen = false }) {
                        products.forEach { product ->
                            DropdownMenuItem(
                                text = { Text("${product.name} · المتاح ${product.stock}") },
                                enabled = product.stock > 0,
                                onClick = {
                                    updatePayload(payload(nextProductId = product.id))
                                    productId = product.id
                                    productMenuOpen = false
                                },
                            )
                        }
                    }
                }
                if (isLoading) LoadingRow()
                error?.let { ErrorBanner(it) }
                if (products.isEmpty() && !isLoading) Text("لا توجد منتجات متاحة بهذا البحث.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    quantity,
                    { value -> val normalized = value.normalizeArabicDigits().filter(Char::isDigit); updatePayload(payload(nextQuantity = normalized)); quantity = normalized },
                    label = { Text("الكمية التالفة") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                androidx.compose.foundation.layout.Box {
                    OutlinedButton(onClick = { reasonMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(reasons.first { it.first == reason }.second)
                    }
                    DropdownMenu(expanded = reasonMenuOpen, onDismissRequest = { reasonMenuOpen = false }) {
                        reasons.forEach { (key, label) ->
                            DropdownMenuItem(text = { Text(label) }, onClick = { updatePayload(payload(nextReason = key)); reason = key; reasonMenuOpen = false })
                        }
                    }
                }
                OutlinedTextField(
                    unitValue,
                    { value -> val normalized = value.normalizeArabicDigits(); updatePayload(payload(nextUnitValue = normalized)); unitValue = normalized },
                    label = { Text("قيمة الوحدة (اختياري، الافتراضي سعر البيع)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                DatePickerField(damagedOn, "تاريخ الهالك", { value -> updatePayload(payload(nextDamagedOn = value)); damagedOn = value }, Modifier.fillMaxWidth())
                OutlinedTextField(notes, { updatePayload(payload(nextNotes = it)); notes = it }, label = { Text("ملاحظات (اختياري)") }, modifier = Modifier.fillMaxWidth())
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                val count = quantity.toIntOrNull()
                if (productId == null || count == null || count < 1 || (selectedProduct != null && count > selectedProduct.stock)) {
                    validationError = "اختر منتجاً وأدخل كمية موجبة لا تتجاوز المخزون المتاح."
                } else if (unitValue.isNotBlank() && !unitValue.isValidPaidAmount()) {
                    validationError = "قيمة الوحدة غير صحيحة."
                } else if (!damagedOn.isValidInvoiceDate()) {
                    validationError = "أدخل تاريخاً صحيحاً بصيغة سنة-شهر-يوم."
                } else {
                    attemptedPayload = payload()
                    onCreate(
                        DamagedItemInputDto(
                            productId = productId!!,
                            quantity = count,
                            reason = reason,
                            unitValue = unitValue.ifBlank { null },
                            damagedOn = damagedOn,
                            notes = notes.trim().ifBlank { null },
                        ),
                        requestKey,
                    )
                }
            }) { Text("تسجيل الهالك") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
internal fun VoidDamagedItemDialog(
    item: DamagedItemDto,
    onDismiss: () -> Unit,
    onVoid: (VoidDamagedItemInputDto, String) -> Unit,
) {
    var reason by rememberSaveable(item.id) { mutableStateOf("") }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedReason by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("حذف سجل الهالك") },
        text = {
            DialogForm(maxHeight = 420.dp) {
                Text("سيتم حذف سجل ${item.productName} وإرجاع ${item.quantity} وحدة إلى المخزون. يبقى السجل في الأرشيف بحالة «ملغى» مع سبب الحذف للمراجعة.")
                OutlinedTextField(
                    reason,
                    { value ->
                        if (attemptedReason != null && attemptedReason != value) requestKey = UUID.randomUUID().toString()
                        reason = value
                    },
                    label = { Text("سبب الإلغاء") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                if (reason.trim().length >= 3) {
                    attemptedReason = reason
                    onVoid(VoidDamagedItemInputDto(reason.trim()), requestKey)
                }
            }) { Text("حذف السجل") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("رجوع") } },
    )
}

@Composable
internal fun PersonalDebtEditDialog(
    debt: PersonalDebtDto?,
    onDismiss: () -> Unit,
    onSave: (Long?, PersonalDebtInputDto, String) -> Unit,
) {
    var creditor by rememberSaveable(debt?.id) { mutableStateOf(debt?.creditor.orEmpty()) }
    var description by rememberSaveable(debt?.id) { mutableStateOf(debt?.description.orEmpty()) }
    var totalAmount by rememberSaveable(debt?.id) { mutableStateOf(debt?.totalAmount.orEmpty()) }
    var paidAmount by rememberSaveable(debt?.id) { mutableStateOf(if (debt == null) "0" else debt.paidAmount) }
    var dueDate by rememberSaveable(debt?.id) { mutableStateOf(debt?.dueDate.orEmpty()) }
    var notes by rememberSaveable(debt?.id) { mutableStateOf(debt?.notes.orEmpty()) }
    var validationError by remember { mutableStateOf<String?>(null) }
    var requestKey by remember(debt?.id) { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember(debt?.id) { mutableStateOf<String?>(null) }

    fun payload(
        nextCreditor: String = creditor,
        nextDescription: String = description,
        nextTotal: String = totalAmount,
        nextPaid: String = paidAmount,
        nextDue: String = dueDate,
        nextNotes: String = notes,
    ) = listOf(nextCreditor, nextDescription, nextTotal, nextPaid, nextDue, nextNotes).joinToString("\u0000")

    fun updatePayload(nextPayload: String) {
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (debt == null) "دين عليّ" else "تعديل الدين الشخصي") },
        text = {
            Column(
                Modifier.fillMaxWidth().imePadding().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("للمبالغ المستحقة عليك لشخص أو جهة خارج مبيعات المتجر.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(creditor, { updatePayload(payload(nextCreditor = it)); creditor = it }, label = { Text("الدائن") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(description, { updatePayload(payload(nextDescription = it)); description = it }, label = { Text("الوصف (اختياري)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(
                    totalAmount,
                    { value -> val normalized = value.normalizeArabicDigits(); updatePayload(payload(nextTotal = normalized)); totalAmount = normalized },
                    label = { Text("إجمالي الدين") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (debt == null) {
                    OutlinedTextField(
                        paidAmount,
                        { value -> val normalized = value.normalizeArabicDigits(); updatePayload(payload(nextPaid = normalized)); paidAmount = normalized },
                        label = { Text("المدفوع الآن (اختياري)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                DatePickerField(dueDate, "تاريخ الاستحقاق (اختياري)", { value -> updatePayload(payload(nextDue = value)); dueDate = value }, Modifier.fillMaxWidth(), nullable = true)
                OutlinedTextField(notes, { updatePayload(payload(nextNotes = it)); notes = it }, label = { Text("ملاحظات") }, modifier = Modifier.fillMaxWidth())
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                val validTotal = totalAmount.isValidPaidAmount() && totalAmount.toBigDecimalOrNull()?.let { it > java.math.BigDecimal.ZERO } == true
                val validPaid = paidAmount.isBlank() || paidAmount.isValidPaidAmount()
                val validDue = dueDate.isBlank() || dueDate.isValidInvoiceDate()
                if (creditor.isBlank() || !validTotal || !validPaid || !validDue) {
                    validationError = "أدخل اسم الدائن وإجماليًا صحيحًا، وتاريخ استحقاق صالح إن وُجد."
                } else {
                    validationError = null
                    attemptedPayload = payload()
                    onSave(
                        debt?.id,
                        PersonalDebtInputDto(
                            creditor = creditor.trim(),
                            description = description.trim().ifBlank { null },
                            totalAmount = totalAmount,
                            paidAmount = if (debt == null) paidAmount.ifBlank { null } else null,
                            dueDate = dueDate.ifBlank { null },
                            notes = notes.trim().ifBlank { null },
                        ),
                        requestKey,
                    )
                }
            }) { Text(if (debt == null) "حفظ الدين" else "حفظ التعديلات") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}
