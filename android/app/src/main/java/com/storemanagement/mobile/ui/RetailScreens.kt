package com.storemanagement.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.storemanagement.mobile.core.network.ApproveRetailShiftDto
import com.storemanagement.mobile.core.network.CloseRetailShiftDto
import com.storemanagement.mobile.core.network.OpenRetailShiftDto
import com.storemanagement.mobile.core.network.RetailDeviceDto
import com.storemanagement.mobile.core.network.RetailShiftDto
import com.storemanagement.mobile.core.network.UserDto
import kotlinx.coroutines.delay
import java.math.BigDecimal
import java.util.UUID

private val shiftStatuses = listOf(
    null to "الكل", "open" to "مفتوحة", "pending_approval" to "تنتظر الاعتماد",
    "closed" to "مغلقة", "approved" to "معتمدة",
)
private val deviceStatuses = listOf(
    null to "الكل", "available" to "متاح", "sold" to "مباع", "quarantined" to "معزول للفحص",
    "voided" to "ملغى", "returned_to_supplier" to "مرتجع للمورد",
)

internal const val retailShiftScreenTag = "retail-shifts-screen"
internal const val retailDeviceScreenTag = "retail-device-screen"
internal const val retailShiftOpenTag = "retail-shift-open"
internal const val retailShiftCloseTag = "retail-shift-close"
internal const val retailShiftConfirmTag = "retail-shift-confirm"

internal fun UserDto.canOperateRetailShifts() = "page.retail_shifts.operate" in permissions
internal fun UserDto.canApproveRetailShifts() = "page.retail_shifts.approve" in permissions
internal fun UserDto.canViewRetailDevices() = "page.retail_devices.view" in permissions
internal fun RetailShiftDto.canClose(user: UserDto) = status == "open" && actorId == user.id && user.canOperateRetailShifts()
internal fun RetailShiftDto.canApprove(user: UserDto) =
    status == "pending_approval" && actorId != user.id && user.canApproveRetailShifts()

private fun Long.egp() = BigDecimal.valueOf(this, 2).toPlainString() + " ج.م."

internal fun retailMinorUnits(value: String): Long? {
    val normalized = value.trim().normalizeArabicDigits().replace('٫', '.')
    if (!normalized.isValidPaidAmount()) return null
    return runCatching { normalized.toBigDecimal().movePointRight(2).longValueExact() }
        .getOrNull()?.takeIf { it in 0..900_000_000_000_000 }
}

private fun String.retailTime() = replace('T', ' ').removeSuffix("Z").substringBefore('.')
private fun List<Pair<String?, String>>.label(value: String) = firstOrNull { it.first == value }?.second ?: value
private fun shiftTone(status: String) = when (status) {
    "open", "approved" -> StatusTone.Positive
    "pending_approval" -> StatusTone.Warning
    else -> StatusTone.Neutral
}

@Composable
internal fun RetailShiftsScreen(
    user: UserDto,
    viewModel: RetailViewModel,
    refreshVersion: Int,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.shifts.collectAsStateWithLifecycle()
    val detail by viewModel.shift.collectAsStateWithLifecycle()
    val movements by viewModel.cashMovements.collectAsStateWithLifecycle()
    val mutation by viewModel.mutation.collectAsStateWithLifecycle()
    var status by rememberSaveable(user.id) { mutableStateOf<String?>(null) }
    var selected by rememberSaveable(user.id) { mutableStateOf<Long?>(null) }
    var action by rememberSaveable(user.id) { mutableStateOf<ShiftAction?>(null) }
    var requestKey by rememberSaveable(user.id) { mutableStateOf<String?>(null) }
    BackHandler(enabled = selected != null && action == null) { selected = null }

    LaunchedEffect(user.id, status, refreshVersion) {
        viewModel.useSession(user.id)
        viewModel.loadShifts(status)
    }
    LaunchedEffect(user.id, selected, refreshVersion) {
        viewModel.useSession(user.id)
        selected?.let {
            viewModel.loadShift(it)
            viewModel.loadMovements(it)
        }
    }
    LaunchedEffect(mutation.completedKey) {
        if (mutation.completedKey != null && mutation.completedKey == requestKey) {
            selected = detail.record?.id
            action = null
            requestKey = null
            viewModel.clearMutation()
        }
    }

    fun start(next: ShiftAction) {
        viewModel.clearMutation()
        requestKey = UUID.randomUUID().toString()
        action = next
    }

    Column(modifier.fillMaxSize().testTag(retailShiftScreenTag).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val id = selected
        if (id == null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (user.canOperateRetailShifts()) {
                    Button(onClick = { start(ShiftAction.Open) }, modifier = Modifier.testTag(retailShiftOpenTag)) { Text("فتح وردية") }
                }
                TextButton(enabled = !state.isLoading, onClick = { viewModel.loadShifts(status) }) { Text("تحديث الورديات") }
            }
            RetailStatusFilter(shiftStatuses, status) { status = it }
            RetailRecordList(
                state, "لا توجد ورديات مطابقة.", { it.id },
                modifier = Modifier.weight(1f),
                onLoadMore = { viewModel.loadShifts(status, state.currentPage + 1) },
            ) { shift ->
                ManagedCard(onClick = { selected = shift.id }) {
                    RetailCardTitle(shift.registerName, shiftStatuses.label(shift.status), shiftTone(shift.status))
                    Text("${shift.actorName} · ${shift.businessDay}")
                    DetailLine("النقد المتوقع", shift.expectedMinor.egp())
                }
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { selected = null }) { Text("كل الورديات") }
                TextButton(enabled = !detail.isLoading, onClick = {
                    viewModel.loadShift(id)
                    viewModel.loadMovements(id)
                }) { Text("تحديث التفاصيل") }
            }
            if (detail.isLoading) LoadingRow()
            detail.error?.let { ErrorBanner(it) }
            detail.record?.takeIf { it.id == id }?.let { shift ->
                LazyColumn(
                    modifier = Modifier.weight(1f),
                    contentPadding = PaddingValues(bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item {
                        RetailShiftSummary(shift)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (shift.canClose(user)) {
                                Button(onClick = { start(ShiftAction.Close) }, modifier = Modifier.testTag(retailShiftCloseTag)) { Text("إغلاق الوردية") }
                            }
                            if (shift.canApprove(user)) Button(onClick = { start(ShiftAction.Approve) }) { Text("اعتماد فرق الوردية") }
                        }
                    }
                    item { Text("وسائل السداد", style = MaterialTheme.typography.titleMedium) }
                    items(shift.totals, key = { it.method }) { total ->
                        ManagedCard {
                            Text(retailMethodLabel(total.method), fontWeight = FontWeight.SemiBold)
                            DetailLine("المقبوض", total.receivedMinor.egp())
                            DetailLine("المدفوع", total.paidOutMinor.egp())
                        }
                    }
                    item { Text("حركات الدرج", style = MaterialTheme.typography.titleMedium) }
                    item {
                        shift.cashMovementTotals.filter { it.amountMinor != 0L }.forEach { total ->
                            DetailLine(retailCashLabel(total.kind), total.amountMinor.egp())
                        }
                        if (movements.isLoading) LoadingRow()
                        movements.error?.let { ErrorBanner(it) }
                        if (movements.items.isEmpty() && !movements.isLoading && movements.error == null) {
                            Text("لا توجد حركات يدوية للدرج.")
                        }
                    }
                    items(movements.items, key = { "cash-${it.id}" }) { movement ->
                        ManagedCard {
                            DetailLine(retailCashLabel(movement.kind), movement.amountMinor.egp())
                            Text("${movement.actorName} · ${movement.createdAt.retailTime()}")
                            Text(movement.reason)
                            movement.reference?.let { Text("المرجع $it") }
                        }
                    }
                    if (movements.currentPage < movements.lastPage) item {
                        OutlinedButton(enabled = !movements.isLoading, onClick = {
                            viewModel.loadMovements(id, movements.currentPage + 1)
                        }) { Text("تحميل المزيد من الحركات") }
                    }
                }
            }
        }
    }

    val currentAction = action
    val key = requestKey
    val currentShift = detail.record?.takeIf { it.id == selected }
    if (currentAction != null && key != null && (currentAction == ShiftAction.Open || currentShift != null)) {
        ShiftActionDialog(
            action = currentAction,
            shift = currentShift,
            mutation = mutation,
            requestKey = key,
            onKeyChange = { requestKey = it },
            onDismiss = { action = null; requestKey = null; viewModel.clearMutation() },
            onSubmit = { actionKey, register, amount, reason ->
                when (currentAction) {
                    ShiftAction.Open -> viewModel.openShift(actionKey, OpenRetailShiftDto(register, requireNotNull(amount)))
                    ShiftAction.Close -> requireNotNull(currentShift).let { shift ->
                        viewModel.closeShift(shift.id, actionKey, CloseRetailShiftDto(requireNotNull(amount), shift.expectedMinor, reason))
                    }
                    ShiftAction.Approve -> viewModel.approveShift(requireNotNull(currentShift).id, actionKey, ApproveRetailShiftDto(reason))
                }
            },
        )
    }
}

@Composable
private fun RetailShiftSummary(shift: RetailShiftDto) {
    ManagedCard {
        RetailCardTitle(shift.registerName, shiftStatuses.label(shift.status), shiftTone(shift.status))
        Text("${shift.actorName} · يوم العمل ${shift.businessDay}")
        DetailLine("الفتح (UTC)", shift.openedAt.retailTime())
        DetailLine("عهدة الفتح", shift.openingMinor.egp())
        DetailLine("النقد المتوقع", shift.expectedMinor.egp())
        shift.observedMinor?.let { DetailLine("النقد الفعلي", it.egp()) }
        shift.differenceMinor?.let { DetailLine("الفرق", it.egp()) }
        shift.closedAt?.let { DetailLine("الإغلاق (UTC)", it.retailTime()) }
        shift.closeReason?.takeIf(String::isNotBlank)?.let { Text("سبب الإغلاق: $it") }
        shift.approvedBy?.let { DetailLine("رقم المشرف المعتمِد", it.toString()) }
        shift.approvedAt?.let { DetailLine("الاعتماد (UTC)", it.retailTime()) }
        shift.approvalReason?.let { Text("سبب الاعتماد: $it") }
    }
}

private enum class ShiftAction(val label: String) {
    Open("فتح وردية"), Close("إغلاق الوردية"), Approve("اعتماد فرق الوردية"),
}

@Composable
private fun ShiftActionDialog(
    action: ShiftAction,
    shift: RetailShiftDto?,
    mutation: RetailMutation,
    requestKey: String,
    onKeyChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onSubmit: (String, String, Long?, String) -> Unit,
) {
    var register by rememberSaveable(action, shift?.id) { mutableStateOf("") }
    var amountText by rememberSaveable(action, shift?.id) { mutableStateOf(if (action == ShiftAction.Open) "0" else "") }
    var reason by rememberSaveable(action, shift?.id) { mutableStateOf("") }
    var submittedPayload by rememberSaveable(action, shift?.id) { mutableStateOf<String?>(null) }
    val minor = retailMinorUnits(amountText)
    val difference = if (action == ShiftAction.Close && minor != null) minor - requireNotNull(shift).expectedMinor else null
    val valid = when (action) {
        ShiftAction.Open -> register.isNotBlank() && minor != null
        ShiftAction.Close -> minor != null && (difference == 0L || reason.isNotBlank())
        ShiftAction.Approve -> reason.isNotBlank()
    }
    val canEdit = !mutation.isSaving
    AlertDialog(
        onDismissRequest = { if (canEdit) onDismiss() },
        title = { Text(action.label) },
        text = {
            DialogForm {
                if (action == ShiftAction.Open) {
                    OutlinedTextField(
                        register, { register = it.take(80) }, label = { Text("اسم درج النقدية") },
                        enabled = canEdit, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (action == ShiftAction.Close) {
                    DetailLine("النقد المتوقع", requireNotNull(shift).expectedMinor.egp())
                }
                if (action == ShiftAction.Approve) {
                    shift?.differenceMinor?.let { DetailLine("فرق الوردية", it.egp()) }
                    shift?.closeReason?.let { Text("سبب الإغلاق: $it") }
                } else {
                    OutlinedTextField(
                        amountText, { amountText = it.take(22) },
                        label = { Text(if (action == ShiftAction.Open) "عهدة الفتح بالجنيه" else "النقد الفعلي بالجنيه") },
                        enabled = canEdit, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                difference?.let { DetailLine("الفرق", it.egp()) }
                if (action != ShiftAction.Open) {
                    val label = when {
                        action == ShiftAction.Approve -> "سبب الاعتماد"
                        difference != null && difference != 0L -> "سبب الفرق (مطلوب)"
                        else -> "ملاحظة الإغلاق (اختياري)"
                    }
                    OutlinedTextField(reason, { reason = it.take(1000) }, label = { Text(label) },
                        enabled = canEdit, modifier = Modifier.fillMaxWidth())
                }
                mutation.error?.let { ErrorBanner(it) }
            }
        },
        confirmButton = {
            Button(enabled = canEdit && valid, modifier = Modifier.testTag(retailShiftConfirmTag), onClick = {
                val payload = listOf(register.trim(), minor, shift?.expectedMinor, reason.trim()).joinToString("\u0000")
                val key = if (submittedPayload == null || submittedPayload == payload) requestKey else UUID.randomUUID().toString()
                submittedPayload = payload
                onKeyChange(key)
                onSubmit(key, register.trim(), minor, reason.trim())
            }) { Text(if (mutation.isSaving) "جارٍ الحفظ…" else action.label) }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = canEdit) { Text("إلغاء") } },
    )
}

@Composable
internal fun RetailDevicesScreen(
    user: UserDto,
    viewModel: RetailViewModel,
    refreshVersion: Int,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.devices.collectAsStateWithLifecycle()
    val detail by viewModel.device.collectAsStateWithLifecycle()
    var query by rememberSaveable(user.id) { mutableStateOf("") }
    var status by rememberSaveable(user.id) { mutableStateOf<String?>(null) }
    var selected by rememberSaveable(user.id) { mutableStateOf<Long?>(null) }
    BackHandler(enabled = selected != null) { selected = null }
    val search = query.trim().ifEmpty { null }
    LaunchedEffect(user.id, query, status, refreshVersion) {
        viewModel.useSession(user.id)
        delay(250)
        viewModel.loadDevices(search, status)
    }
    LaunchedEffect(user.id, selected, refreshVersion) {
        viewModel.useSession(user.id)
        selected?.let(viewModel::loadDevice)
    }

    Column(modifier.fillMaxSize().testTag(retailDeviceScreenTag).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val id = selected
        if (id == null) {
            OutlinedTextField(query, { query = it.take(100) }, label = { Text("الرقم التسلسلي أو IMEI") },
                singleLine = true, modifier = Modifier.fillMaxWidth())
            RetailStatusFilter(deviceStatuses, status) { status = it }
            RetailRecordList(
                state, "لا توجد أجهزة مطابقة.", { it.id },
                modifier = Modifier.weight(1f),
                onLoadMore = { viewModel.loadDevices(search, status, state.currentPage + 1) },
            ) { device ->
                ManagedCard(onClick = { selected = device.id }) { RetailDeviceIdentity(device) }
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { selected = null }) { Text("كل الأجهزة") }
                TextButton(enabled = !detail.isLoading, onClick = { viewModel.loadDevice(id) }) { Text("تحديث التفاصيل") }
            }
            if (detail.isLoading) LoadingRow()
            detail.error?.let { ErrorBanner(it) }
            detail.record?.takeIf { it.id == id }?.let { RetailDeviceDetails(it, Modifier.weight(1f)) }
        }
    }
}

@Composable
private fun RetailDeviceIdentity(device: RetailDeviceDto) {
    RetailCardTitle(device.productName, deviceStatuses.label(device.status), StatusTone.Neutral)
    device.serialNumber?.let { DetailLine("الرقم التسلسلي", it) }
    device.imei1?.let { DetailLine("IMEI 1", it) }
    device.imei2?.let { DetailLine("IMEI 2", it) }
}

@Composable
private fun RetailDeviceDetails(device: RetailDeviceDto, modifier: Modifier = Modifier) {
    LazyColumn(
        modifier = modifier,
        contentPadding = PaddingValues(bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            ManagedCard {
                RetailDeviceIdentity(device)
                DetailLine("استلام المخزون", "#${device.receiptId}")
                device.purchaseId?.let { DetailLine("المشتريات", "#$it") }
            }
        }
        item { Text("المبيعات والضمان", style = MaterialTheme.typography.titleMedium) }
        if (device.sales.isEmpty()) item { Text("لا توجد فاتورة بيع لهذا الجهاز.") }
        items(device.sales, key = { "sale-${it.invoiceId}" }) { sale ->
            ManagedCard {
                RetailCardTitle("فاتورة #${sale.invoiceId}", warrantyLabel(sale.warrantyStatus), StatusTone.Neutral)
                DetailLine("تاريخ الفاتورة", sale.invoiceDate)
                if (sale.warrantyMonths > 0) {
                    DetailLine("المدة", "${sale.warrantyMonths} شهر")
                    DetailLine("بدء الضمان من", warrantyBasisLabel(sale.warrantyBasis))
                    sale.warrantyGuarantor?.let { DetailLine("جهة الضمان", it) }
                    sale.warrantyStartsOn?.let { DetailLine("يبدأ في", it) }
                    sale.warrantyExpiresOn?.let { DetailLine("ينتهي في", it) }
                    sale.warrantyProofReference?.let { Text("مرجع الإثبات: $it") }
                }
            }
        }
        if (device.events.isNotEmpty()) item { Text("أحداث الجهاز", style = MaterialTheme.typography.titleMedium) }
        items(device.events, key = { "event-${it.id}" }) { event ->
            ManagedCard {
                DetailLine(deviceEventLabel(event.kind), event.occurredOn)
                Text("فاتورة #${event.invoiceId}")
                event.proofReference?.let { Text("مرجع الإثبات: $it") }
                if (event.note.isNotBlank()) Text(event.note)
            }
        }
        if (device.returns.isNotEmpty()) item { Text("المرتجعات", style = MaterialTheme.typography.titleMedium) }
        items(device.returns, key = { "return-${it.returnId}" }) { returned ->
            ManagedCard {
                Text("مرتجع #${returned.returnId} · فاتورة #${returned.invoiceId}")
                Text(if (returned.disposition == "restock") "أعيد إلى المخزون" else "عزل للفحص")
                device.quarantineResolutions.firstOrNull { it.returnId == returned.returnId }?.let {
                    DetailLine("عاد إلى المخزون (UTC)", it.createdAt.retailTime())
                    Text(it.reason)
                }
            }
        }
        if (device.repairs.isNotEmpty()) item { Text("الصيانة", style = MaterialTheme.typography.titleMedium) }
        items(device.repairs, key = { "repair-${it.id}" }) { repair ->
            ManagedCard {
                DetailLine("#${repair.id} · ${repair.item}", repair.status)
                DetailLine("تاريخ الطلب", repair.requestedDate)
                repair.completedDate?.let { DetailLine("تاريخ الإكمال", it) }
            }
        }
    }
}

@Composable
private fun RetailCardTitle(title: String, status: String, tone: StatusTone) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        StatusChip(status, tone)
    }
}

@Composable
private fun RetailStatusFilter(options: List<Pair<String?, String>>, status: String?, onChange: (String?) -> Unit) {
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            FilterChip(selected = status == value, onClick = { onChange(value) }, label = { Text(label) })
        }
    }
}

@Composable
private fun <T> RetailRecordList(
    state: RemotePage<T>,
    emptyMessage: String,
    key: (T) -> Any,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable (T) -> Unit,
) {
    if (state.items.isEmpty()) {
        Column(modifier.fillMaxWidth()) {
            val error = state.error
            when {
                state.isLoading -> LoadingRow()
                error != null -> ErrorBanner(error)
                else -> EmptyState(emptyMessage)
            }
        }
        return
    }
    LazyColumn(modifier, contentPadding = PaddingValues(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(state.items, key = key) { content(it) }
        if (state.isLoading) item { LoadingRow() }
        state.error?.let { error -> item { ErrorBanner(error) } }
        if (state.currentPage < state.lastPage) item {
            OutlinedButton(enabled = !state.isLoading, onClick = onLoadMore) { Text("تحميل المزيد") }
        }
    }
}

private fun retailMethodLabel(method: String) = when (method) {
    "cash" -> "نقدي"
    "card" -> "بطاقة"
    "wallet" -> "محفظة إلكترونية"
    "bank_transfer" -> "تحويل بنكي"
    else -> method
}

private fun retailCashLabel(kind: String) = when (kind) {
    "safe_deposit" -> "إيداع بالخزنة"
    "safe_withdrawal" -> "سحب من الخزنة"
    "general_expense" -> "مصروف عام"
    else -> kind
}

private fun warrantyLabel(status: String) = when (status) {
    "active" -> "ضمان ساري"
    "pending" -> "بانتظار بدء الضمان"
    "expired" -> "انتهى الضمان"
    "returned" -> "مرتجع"
    "none" -> "بدون ضمان"
    else -> status
}

private fun warrantyBasisLabel(basis: String) = when (basis) {
    "sale" -> "البيع"
    "delivery" -> "التسليم"
    "installation" -> "التركيب"
    else -> basis
}

private fun deviceEventLabel(kind: String) = when (kind) {
    "delivered" -> "التسليم"
    "installed" -> "التركيب"
    "warranty_claim" -> "مطالبة ضمان"
    else -> kind
}
