package com.storemanagement.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.storemanagement.mobile.core.network.CashierProductDto
import com.storemanagement.mobile.core.network.CustomerDto
import com.storemanagement.mobile.core.network.RetailCheckoutDto
import com.storemanagement.mobile.core.network.RetailCheckoutLineDto
import com.storemanagement.mobile.core.network.RetailCheckoutReceiptDto
import com.storemanagement.mobile.core.network.RetailDeviceDto
import com.storemanagement.mobile.core.network.RetailPaymentDto
import com.storemanagement.mobile.core.network.UserDto
import kotlinx.coroutines.delay
import java.math.BigDecimal
import java.util.UUID

internal data class PosCartLine(val product: CashierProductDto, val quantity: Int)

private val tenderMethods = listOf(
    "cash" to "نقدي", "card" to "بطاقة", "wallet" to "محفظة", "bank_transfer" to "تحويل بنكي",
)

private data class TenderEntry(val amount: String = "", val reference: String = "")

private fun Long.asEgp() = BigDecimal.valueOf(this, 2).toPlainString()

@Composable
internal fun RetailCheckoutDialog(
    user: UserDto,
    viewModel: RetailViewModel,
    cart: List<PosCartLine>,
    totalMinor: Long,
    onOpenShifts: () -> Unit,
    onDismiss: () -> Unit,
    onComplete: (RetailCheckoutReceiptDto) -> Unit,
) {
    val contextState by viewModel.checkoutContext.collectAsStateWithLifecycle()
    val mutation by viewModel.checkoutMutation.collectAsStateWithLifecycle()
    val context = contextState.record
    val shift = context?.ownedShift
    val hasShift = shift != null
    val canEdit = !mutation.isSaving
    var tenders by remember { mutableStateOf(mapOf("cash" to TenderEntry(totalMinor.asEgp()))) }
    var customer by remember { mutableStateOf<CustomerDto?>(null) }
    var selectedDevices by remember { mutableStateOf<Map<Long, List<RetailDeviceDto>>>(emptyMap()) }
    var selectingCustomer by remember { mutableStateOf(false) }
    var selectingLine by remember { mutableStateOf<PosCartLine?>(null) }
    var formError by remember { mutableStateOf<String?>(null) }
    var attempted by remember { mutableStateOf<Pair<RetailCheckoutDto, String>?>(null) }
    val tracked = cart.filter { it.product.tracking != "quantity" }
    val methods = if (hasShift) tenderMethods else tenderMethods.take(1)
    val paidForDisplay = methods.sumOf { (method, _) -> retailMinorUnits(tenders[method]?.amount.orEmpty()) ?: 0L }

    LaunchedEffect(user.id) {
        viewModel.useSession(user.id)
        viewModel.clearCheckoutMutation()
        viewModel.loadCheckoutContext(user.id, user.canOperateRetailShifts())
    }

    fun submit() {
        val payments = mutableListOf<RetailPaymentDto>()
        for ((method, _) in methods) {
            val entry = tenders[method] ?: continue
            if (entry.amount.isBlank()) continue
            val amount = retailMinorUnits(entry.amount)
            if (amount == null) {
                formError = "أدخل مبلغًا صحيحًا بالجنيه والقرش لكل وسيلة سداد."
                return
            }
            if (amount > 0L) payments.add(RetailPaymentDto(method, amount, entry.reference.trim().ifEmpty { null }))
        }
        val paid = payments.sumOf { it.amountMinor }
        formError = when {
            paid > totalMinor -> "إجمالي السداد يتجاوز قيمة الفاتورة."
            paid < totalMinor && customer == null -> "اختر عميلًا عند البيع الآجل أو الدفع الجزئي."
            context?.requiresShift != false && shift == null -> "افتح وردية قبل إتمام البيع."
            tracked.any { selectedDevices[it.product.id].orEmpty().size != it.quantity } -> "اختر جهازًا لكل قطعة في الأصناف المتتبعة."
            else -> null
        }
        if (formError != null) return
        val input = RetailCheckoutDto(
            customerId = customer?.id,
            items = cart.map { line ->
                RetailCheckoutLineDto(line.product.id, line.quantity, selectedDevices[line.product.id]?.map { it.id }?.sorted())
            },
            paidMinor = paid,
            expectedTotalMinor = totalMinor,
            shiftId = shift?.id,
            payments = if (hasShift) payments else null,
        )
        val key = attempted?.takeIf { it.first == input }?.second ?: UUID.randomUUID().toString()
        attempted = input to key
        viewModel.checkout(key, input, onComplete)
    }

    if (selectingCustomer) {
        RetailCheckoutCustomerPicker(viewModel, onDismiss = { selectingCustomer = false }) {
            customer = it
            selectingCustomer = false
        }
        return
    }
    selectingLine?.let { line ->
        RetailCheckoutDevicePicker(
            line, viewModel, selectedDevices[line.product.id].orEmpty(),
            onDismiss = { selectingLine = null },
            onSelected = {
                selectedDevices = selectedDevices + (line.product.id to it)
                selectingLine = null
            },
        )
        return
    }

    BackHandler(enabled = mutation.isSaving) {}
    AlertDialog(
        onDismissRequest = { if (canEdit) onDismiss() },
        title = { Text("تحصيل الفاتورة") },
        text = {
            DialogForm {
                DetailLine("الإجمالي", "${totalMinor.asEgp()} ج.م.")
                if (contextState.isLoading) LoadingRow()
                contextState.error?.let {
                    ErrorBanner(it)
                    TextButton(onClick = { viewModel.loadCheckoutContext(user.id, user.canOperateRetailShifts()) }) { Text("تحديث الوردية") }
                }
                if (shift != null) DetailLine("الوردية", shift.registerName)
                else if (context?.requiresShift == true) {
                    Text("يلزم فتح وردية لهذا الحساب لإتمام البيع.")
                    if (user.canOperateRetailShifts()) TextButton(onClick = onOpenShifts) { Text("الذهاب للورديات") }
                } else if (context != null) {
                    Text("لا توجد وردية مفتوحة. يمكن تسجيل تحصيل نقدي.")
                }
                if ("page.customers.view" in user.permissions) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        TextButton(enabled = canEdit, onClick = { selectingCustomer = true }) {
                            Text(customer?.let { "العميل: ${it.name}" } ?: "اختيار عميل")
                        }
                        if (customer != null) TextButton(enabled = canEdit, onClick = { customer = null }) { Text("مسح") }
                    }
                }
                tracked.forEach { line ->
                    val selection = selectedDevices[line.product.id].orEmpty()
                    TextButton(enabled = canEdit, onClick = { selectingLine = line }) {
                        Text("${line.product.name} · اختيار الأجهزة ${selection.size}/${line.quantity}")
                    }
                }
                if (context != null && (shift != null || !context.requiresShift)) methods.forEach { (method, label) ->
                    val entry = tenders[method] ?: TenderEntry()
                    OutlinedTextField(
                        entry.amount, { amount -> tenders = tenders + (method to entry.copy(amount = amount.take(22))) },
                        label = { Text("$label بالجنيه") }, enabled = canEdit, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (method != "cash" && (retailMinorUnits(entry.amount) ?: 0L) > 0L) OutlinedTextField(
                        entry.reference, { reference -> tenders = tenders + (method to entry.copy(reference = reference.take(100))) },
                        label = { Text("مرجع $label (اختياري)") }, enabled = canEdit, singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                DetailLine("المدفوع", "${paidForDisplay.asEgp()} ج.م.")
                DetailLine("المتبقي", "${(totalMinor - paidForDisplay).coerceAtLeast(0L).asEgp()} ج.م.")
                (formError ?: mutation.error)?.let { ErrorBanner(it) }
            }
        },
        confirmButton = {
            Button(
                enabled = canEdit && context != null && (shift != null || !context.requiresShift),
                onClick = ::submit,
            ) { Text(if (mutation.isSaving) "جارٍ إتمام البيع…" else "تأكيد البيع") }
        },
        dismissButton = { TextButton(enabled = canEdit, onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
private fun RetailCheckoutDevicePicker(
    line: PosCartLine,
    viewModel: RetailViewModel,
    initialSelection: List<RetailDeviceDto>,
    onDismiss: () -> Unit,
    onSelected: (List<RetailDeviceDto>) -> Unit,
) {
    val state by viewModel.checkoutDevices.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    var selection by remember { mutableStateOf(initialSelection) }
    val search = query.trim().ifEmpty { null }
    LaunchedEffect(line.product.id, search) {
        delay(250)
        viewModel.loadCheckoutDevices(line.product.id, search)
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("الأجهزة المتاحة · ${line.product.name}") },
        text = {
            DialogForm {
                Text("تم اختيار ${selection.size} من ${line.quantity}", fontWeight = FontWeight.SemiBold)
                selection.forEach { selected ->
                    TextButton(onClick = { selection = selection.filterNot { it.id == selected.id } }) {
                        Text("إزالة ${selected.displayIdentity()}")
                    }
                }
                OutlinedTextField(query, { query = it.take(100) }, label = { Text("الرقم التسلسلي أو IMEI") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                state.error?.let { ErrorBanner(it) }
                if (state.isLoading) LoadingRow()
                if (state.items.isEmpty() && !state.isLoading && state.error == null) Text("لا توجد أجهزة مطابقة.")
                state.items.filter { device ->
                    device.productId == line.product.id && selection.none { it.id == device.id }
                }.forEach { device ->
                    TextButton(
                        enabled = selection.size < line.quantity,
                        onClick = { selection = selection + device },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(device.displayIdentity()) }
                }
                if (state.currentPage < state.lastPage) TextButton(enabled = !state.isLoading, onClick = {
                    viewModel.loadCheckoutDevices(line.product.id, search, state.currentPage + 1)
                }) { Text("تحميل المزيد") }
            }
        },
        confirmButton = { Button(enabled = selection.size == line.quantity, onClick = { onSelected(selection) }) { Text("اعتماد الأجهزة") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("رجوع") } },
    )
}

@Composable
private fun RetailCheckoutCustomerPicker(
    viewModel: RetailViewModel,
    onDismiss: () -> Unit,
    onSelected: (CustomerDto) -> Unit,
) {
    val state by viewModel.checkoutCustomers.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }
    val search = query.trim().ifEmpty { null }
    LaunchedEffect(search) {
        delay(250)
        viewModel.loadCheckoutCustomers(search)
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("اختيار عميل") },
        text = {
            DialogForm {
                OutlinedTextField(query, { query = it.take(100) }, label = { Text("اسم العميل أو الهاتف") },
                    singleLine = true, modifier = Modifier.fillMaxWidth())
                state.error?.let { ErrorBanner(it) }
                if (state.isLoading) LoadingRow()
                if (state.items.isEmpty() && !state.isLoading && state.error == null) Text("لا يوجد عملاء مطابقون.")
                state.items.forEach { customer ->
                    TextButton(onClick = { onSelected(customer) }, modifier = Modifier.fillMaxWidth()) {
                        Column {
                            Text(customer.name)
                            Text(customer.phone ?: "#${customer.id}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
                if (state.currentPage < state.lastPage) TextButton(enabled = !state.isLoading, onClick = {
                    viewModel.loadCheckoutCustomers(search, state.currentPage + 1)
                }) { Text("تحميل المزيد") }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("رجوع") } },
    )
}

private fun RetailDeviceDto.displayIdentity(): String =
    listOfNotNull(serialNumber, imei1, imei2).joinToString(" · ").ifBlank { "#$id" }
