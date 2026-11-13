package com.storemanagement.mobile.ui

import android.app.DatePickerDialog
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.horizontalScroll
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.text.style.TextAlign
import com.storemanagement.mobile.core.database.CachedProduct
import com.storemanagement.mobile.core.network.DamagedItemDto
import com.storemanagement.mobile.core.network.DamagedItemInputDto
import com.storemanagement.mobile.core.network.InstallmentDto
import com.storemanagement.mobile.core.network.InvoiceDto
import com.storemanagement.mobile.core.network.MaintenanceDto
import com.storemanagement.mobile.core.network.PersonalDebtDto
import java.math.BigDecimal
import java.math.RoundingMode
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Calendar
import java.util.Locale
import java.util.UUID

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

internal enum class StatusTone { Positive, Warning, Danger, Neutral }

internal enum class ActionStyle { Filled, Tonal, Outlined, Danger }

internal data class ChoiceOption(
    val value: String,
    val label: String,
    val enabled: Boolean = true,
    val hint: String? = null,
)

internal val DamagedReasonOptions = listOf(
    "broken" to "كسر",
    "water" to "تلف بالمياه",
    "defective" to "عيب تصنيع",
    "not_working" to "لا يعمل",
    "lost" to "فقد / سرقة",
    "expired" to "منتهي الصلاحية",
    "returned" to "مرتجع تالف",
    "other" to "أخرى",
)

internal fun maintenanceStatusOptions(record: MaintenanceDto?, hilal: Boolean): List<String> =
    if (!hilal) listOf("قيد الانتظار", "قيد الصيانة", "مكتمل", "مرفوض") else when (val status = record?.status) {
        null -> listOf("قيد الانتظار", "قيد الصيانة")
        "قيد الانتظار" -> listOf("قيد الانتظار", "قيد الصيانة", "مرفوض")
        "قيد الصيانة" -> listOf("قيد الصيانة", "مكتمل", "مرفوض")
        "مكتمل" -> listOf("مكتمل", "تم التسليم", "مرفوض")
        else -> listOf(status)
    }

private fun String.moneyOrZero(): BigDecimal = trim().toBigDecimalOrNull() ?: BigDecimal.ZERO

private fun BigDecimal.display(): String = setScale(2, RoundingMode.HALF_UP).toPlainString()

private fun String.toShortDate(): String = take(10).toArabicDateDisplay()

private fun todayIso(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

@Composable
internal fun StatusChip(text: String, tone: StatusTone, modifier: Modifier = Modifier) {
    val container: Color
    val content: Color
    when (tone) {
        StatusTone.Positive -> {
            container = MaterialTheme.colorScheme.primaryContainer
            content = MaterialTheme.colorScheme.onPrimaryContainer
        }
        StatusTone.Warning -> {
            container = MaterialTheme.colorScheme.secondaryContainer
            content = MaterialTheme.colorScheme.onSecondaryContainer
        }
        StatusTone.Danger -> {
            container = MaterialTheme.colorScheme.errorContainer
            content = MaterialTheme.colorScheme.onErrorContainer
        }
        StatusTone.Neutral -> {
            container = MaterialTheme.colorScheme.surfaceVariant
            content = MaterialTheme.colorScheme.onSurfaceVariant
        }
    }
    Surface(modifier = modifier, color = container, contentColor = content, shape = RoundedCornerShape(50)) {
        Text(
            text,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
internal fun CardActionButton(
    label: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    style: ActionStyle = ActionStyle.Outlined,
    enabled: Boolean = true,
) {
    val padding = PaddingValues(horizontal = 10.dp, vertical = 8.dp)
    val content: @Composable RowScope.() -> Unit = {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelLarge)
    }
    when (style) {
        ActionStyle.Filled -> Button(onClick = onClick, modifier = modifier, enabled = enabled, contentPadding = padding, content = content)
        ActionStyle.Tonal -> FilledTonalButton(onClick = onClick, modifier = modifier, enabled = enabled, contentPadding = padding, content = content)
        ActionStyle.Outlined -> OutlinedButton(onClick = onClick, modifier = modifier, enabled = enabled, contentPadding = padding, content = content)
        ActionStyle.Danger -> OutlinedButton(
            onClick = onClick,
            modifier = modifier,
            enabled = enabled,
            contentPadding = padding,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = if (enabled) 0.6f else 0.2f)),
            content = content,
        )
    }
}

/** Scrollable column for dialog bodies so every form stays reachable on small screens and with the keyboard open. */
@Composable
internal fun DialogForm(
    maxHeight: Dp = 520.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .imePadding()
            .heightIn(max = maxHeight)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}

@Composable
internal fun DatePickerField(
    value: String,
    label: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    nullable: Boolean = false,
) {
    val context = LocalContext.current
    OutlinedTextField(
        value = value,
        onValueChange = {},
        label = { Text(label) },
        readOnly = true,
        singleLine = true,
        modifier = modifier,
        trailingIcon = {
            Row {
                IconButton(onClick = {
                    val calendar = Calendar.getInstance()
                    runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(value) }.getOrNull()?.let { calendar.time = it }
                    DatePickerDialog(
                        context,
                        { _, year, month, day -> onValueChange(String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, day)) },
                        calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH),
                    ).show()
                }) { Icon(Icons.Filled.DateRange, contentDescription = "Choose date") }
                if (nullable && value.isNotBlank()) {
                    IconButton(onClick = { onValueChange("") }) { Icon(Icons.Filled.Delete, contentDescription = "Clear date") }
                }
            }
        },
    )
}

@Composable
internal fun ManagedCard(
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val shape = RoundedCornerShape(14.dp)
    val colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    val border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)
    if (onClick != null) {
        Card(onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = shape, colors = colors, border = border) {
            Column(
                Modifier.fillMaxWidth().padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                content = content,
            )
        }
    } else {
        Card(modifier = Modifier.fillMaxWidth(), shape = shape, colors = colors, border = border) {
            Column(
                Modifier.fillMaxWidth().padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                content = content,
            )
        }
    }
}

@Composable
internal fun InfoStat(label: String, value: String, modifier: Modifier = Modifier, emphasize: Boolean = false) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            value,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = if (emphasize) FontWeight.Bold else FontWeight.Medium,
            color = if (emphasize) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun SummaryTile(label: String, value: String, modifier: Modifier = Modifier, tone: StatusTone = StatusTone.Neutral) {
    val container = when (tone) {
        StatusTone.Positive -> MaterialTheme.colorScheme.primaryContainer
        StatusTone.Warning -> MaterialTheme.colorScheme.secondaryContainer
        StatusTone.Danger -> MaterialTheme.colorScheme.errorContainer
        StatusTone.Neutral -> MaterialTheme.colorScheme.surfaceVariant
    }
    Surface(modifier = modifier, color = container, shape = RoundedCornerShape(12.dp)) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall)
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
internal fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
    destructive: Boolean = true,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { DialogForm(maxHeight = 320.dp) { Text(message) } },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, 
                onClick = onConfirm,
                colors = if (destructive) {
                    ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    )
                } else {
                    ButtonDefaults.buttonColors()
                },
            ) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

/**
 * Radio-list dialog used for every "change status" action. The request key is rotated whenever
 * the choice changes after an attempt, so a retry of the same choice stays idempotent.
 */
@Composable
internal fun StatusChoiceDialog(
    title: String,
    summary: String?,
    options: List<ChoiceOption>,
    initial: String?,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: (String, String) -> Unit,
) {
    var selected by rememberSaveable(title, initial) { mutableStateOf(initial) }
    var requestKey by remember(title, initial) { mutableStateOf(UUID.randomUUID().toString()) }
    var attempted by remember(title, initial) { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            DialogForm(maxHeight = 460.dp) {
                summary?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                options.forEach { option ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable(enabled = option.enabled) {
                                if (attempted != null && attempted != option.value) {
                                    requestKey = UUID.randomUUID().toString()
                                    attempted = null
                                }
                                selected = option.value
                            }
                            .padding(vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = selected == option.value, onClick = null, enabled = option.enabled)
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(
                                option.label,
                                color = if (option.enabled) Color.Unspecified else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                                fontWeight = if (option.value == initial) FontWeight.SemiBold else FontWeight.Normal,
                            )
                            option.hint?.let {
                                Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            Button(
                enabled = selected != null && selected != initial && !LocalIsSaving.current,
                onClick = {
                    val value = selected
                    if (value != null) {
                        attempted = value
                        onConfirm(value, requestKey)
                    }
                },
            ) { Text(confirmLabel) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

// ---------------------------------------------------------------------------
// Installments + personal debts ("ديوني")
// ---------------------------------------------------------------------------

internal fun installmentStatusOptions(installment: InstallmentDto): List<ChoiceOption> {
    val hasBalance = installment.remaining.moneyOrZero().signum() > 0
    return listOf(
        ChoiceOption("غير مكتمل", "غير مكتمل", enabled = hasBalance, hint = if (hasBalance) null else "القسط مسدد بالكامل"),
        ChoiceOption("متأخر", "متأخر", enabled = hasBalance, hint = if (hasBalance) null else "القسط مسدد بالكامل"),
        ChoiceOption("مكتمل", "مكتمل", enabled = !hasBalance, hint = if (hasBalance) "سجّل دفعة بالمتبقي أولاً" else null),
    )
}

internal fun InstallmentDto.statusValueForDialog(): String? = when (status.toArabicInstallmentStatus()) {
    "مكتمل" -> "مكتمل"
    "متأخر" -> "متأخر"
    "غير مكتمل" -> "غير مكتمل"
    else -> null
}

@Composable
internal fun InstallmentsHubScreen(
    section: String,
    onSectionChange: (String) -> Unit,
    installments: RemotePage<InstallmentDto>,
    personalDebts: RemotePage<PersonalDebtDto>,
    query: String,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    canManage: Boolean,
    onInstallmentClick: (InstallmentDto) -> Unit,
    onInstallmentPay: (InstallmentDto) -> Unit,
    onInstallmentStatus: (InstallmentDto) -> Unit,
    onInstallmentEdit: (InstallmentDto) -> Unit,
    onInstallmentDelete: (InstallmentDto) -> Unit,
    onLoadMoreInstallments: () -> Unit,
    onDebtClick: (PersonalDebtDto) -> Unit,
    onDebtPay: (PersonalDebtDto) -> Unit,
    onDebtEdit: (PersonalDebtDto) -> Unit,
    onDebtDelete: (PersonalDebtDto) -> Unit,
    onLoadMoreDebts: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            FilterChip(
                selected = section != "personal",
                onClick = { onSectionChange("customers") },
                label = { Text("ديون العملاء (${installments.total})") },
            )
            FilterChip(
                selected = section == "personal",
                onClick = { onSectionChange("personal") },
                label = { Text("ديون عليّ (${personalDebts.total})") },
            )
        }
        if (section == "personal") {
            PersonalDebtsList(
                state = personalDebts,
                canManage = canManage,
                onClick = onDebtClick,
                onPay = onDebtPay,
                onEdit = onDebtEdit,
                onDelete = onDebtDelete,
                onLoadMore = onLoadMoreDebts,
            )
        } else {
            CustomerInstallmentsList(
                state = installments,
                canManage = canManage,
                onClick = onInstallmentClick,
                onPay = onInstallmentPay,
                onStatus = onInstallmentStatus,
                onEdit = onInstallmentEdit,
                onDelete = onInstallmentDelete,
                onLoadMore = onLoadMoreInstallments,
            )
        }
    }
}

@Composable
private fun CustomerInstallmentsList(
    state: RemotePage<InstallmentDto>,
    canManage: Boolean,
    onClick: (InstallmentDto) -> Unit,
    onPay: (InstallmentDto) -> Unit,
    onStatus: (InstallmentDto) -> Unit,
    onEdit: (InstallmentDto) -> Unit,
    onDelete: (InstallmentDto) -> Unit,
    onLoadMore: () -> Unit,
) {
    state.error?.let { ErrorBanner(it) }
    when {
        state.isLoading && state.items.isEmpty() -> LoadingRow()
        state.items.isEmpty() -> EmptyState(if (state.error != null) "تعذر تحميل الأقساط" else "لا توجد ديون عملاء")
        else -> {
            val outstanding = state.items.fold(BigDecimal.ZERO) { sum, item -> sum + item.remaining.moneyOrZero() }
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SummaryTile("المتبقي على العملاء (القائمة المعروضة)", "${outstanding.display()} ج.م", Modifier.weight(1f), StatusTone.Warning)
                        SummaryTile("عدد الأقساط", state.total.toString(), Modifier.weight(0.6f))
                    }
                }
                items(state.items, key = InstallmentDto::id) { installment ->
                    InstallmentCard(installment, canManage, onClick, onPay, onStatus, onEdit, onDelete)
                }
                item { LoadMoreButton(state, onLoadMore) }
            }
        }
    }
}

@Composable
private fun InstallmentCard(
    installment: InstallmentDto,
    canManage: Boolean,
    onClick: (InstallmentDto) -> Unit,
    onPay: (InstallmentDto) -> Unit,
    onStatus: (InstallmentDto) -> Unit,
    onEdit: (InstallmentDto) -> Unit,
    onDelete: (InstallmentDto) -> Unit,
) {
    val remaining = installment.remaining.moneyOrZero()
    val paid = installment.paidAmount.moneyOrZero()
    val total = paid + remaining
    val progress = if (total.signum() > 0) paid.divide(total, 4, RoundingMode.HALF_UP).toFloat().coerceIn(0f, 1f) else 0f
    val statusLabel = installment.status.toArabicInstallmentStatus()
    val tone = when (statusLabel) {
        "مكتمل" -> StatusTone.Positive
        "متأخر" -> StatusTone.Danger
        "غير مكتمل" -> StatusTone.Warning
        else -> StatusTone.Neutral
    }

    ManagedCard(onClick = { onClick(installment) }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(
                installment.customer,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.width(8.dp))
            StatusChip(statusLabel, tone)
        }
        Text(
            installment.productName,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            InfoStat("الإجمالي", total.display(), Modifier.weight(1f))
            InfoStat("المدفوع", paid.display(), Modifier.weight(1f))
            InfoStat("المتبقي", remaining.display(), Modifier.weight(1f), emphasize = true)
        }
        Text(
            "موعد السداد: ${installment.nextPaymentDate?.toShortDate() ?: "غير محدد"}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (canManage) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (remaining.signum() > 0) {
                    CardActionButton("دفعة جديدة", Icons.Filled.Payments, { onPay(installment) }, Modifier.weight(1f), ActionStyle.Filled)
                }
                CardActionButton("تغيير الحالة", Icons.Filled.SwapHoriz, { onStatus(installment) }, Modifier.weight(1f), ActionStyle.Tonal)
            }
            if (installment.invoiceId == null) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    CardActionButton("تعديل", Icons.Filled.Edit, { onEdit(installment) }, Modifier.weight(1f))
                    CardActionButton("حذف", Icons.Filled.Delete, { onDelete(installment) }, Modifier.weight(1f), ActionStyle.Danger)
                }
            } else {
                Text(
                    "قسط مرتبط بفاتورة: يمكن إدارة بياناته من الفاتورة.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun PersonalDebtsList(
    state: RemotePage<PersonalDebtDto>,
    canManage: Boolean,
    onClick: (PersonalDebtDto) -> Unit,
    onPay: (PersonalDebtDto) -> Unit,
    onEdit: (PersonalDebtDto) -> Unit,
    onDelete: (PersonalDebtDto) -> Unit,
    onLoadMore: () -> Unit,
) {
    state.error?.let { ErrorBanner(it) }
    when {
        state.isLoading && state.items.isEmpty() -> LoadingRow()
        state.items.isEmpty() -> EmptyState(
            if (state.error != null) "تعذر تحميل الديون الشخصية" else "لا توجد ديون عليك. اضغط + لتسجيل دين جديد.",
        )
        else -> {
            val today = todayIso()
            val owed = state.items.fold(BigDecimal.ZERO) { sum, item -> sum + item.remaining.moneyOrZero() }
            val overdueCount = state.items.count { it.status == "open" && it.dueDate != null && it.dueDate < today }
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        SummaryTile("إجمالي ما عليّ (القائمة المعروضة)", "${owed.display()} ج.م", Modifier.weight(1f), StatusTone.Warning)
                        SummaryTile(
                            "متأخرة",
                            overdueCount.toString(),
                            Modifier.weight(0.6f),
                            if (overdueCount > 0) StatusTone.Danger else StatusTone.Neutral,
                        )
                    }
                }
                items(state.items, key = PersonalDebtDto::id) { debt ->
                    PersonalDebtCard(debt, today, canManage, onClick, onPay, onEdit, onDelete)
                }
                item { LoadMoreButton(state, onLoadMore) }
            }
        }
    }
}

@Composable
private fun PersonalDebtCard(
    debt: PersonalDebtDto,
    today: String,
    canManage: Boolean,
    onClick: (PersonalDebtDto) -> Unit,
    onPay: (PersonalDebtDto) -> Unit,
    onEdit: (PersonalDebtDto) -> Unit,
    onDelete: (PersonalDebtDto) -> Unit,
) {
    val remaining = debt.remaining.moneyOrZero()
    val paid = debt.paidAmount.moneyOrZero()
    val total = debt.totalAmount.moneyOrZero()
    val isOpen = debt.status.toArabicPersonalDebtStatus() == "مفتوح" && remaining.signum() > 0
    val isOverdue = isOpen && debt.dueDate != null && debt.dueDate < today
    val progress = if (total.signum() > 0) paid.divide(total, 4, RoundingMode.HALF_UP).toFloat().coerceIn(0f, 1f) else 0f

    ManagedCard(onClick = { onClick(debt) }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(
                debt.creditor,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.width(8.dp))
            when {
                !isOpen -> StatusChip("مسدد", StatusTone.Positive)
                isOverdue -> StatusChip("متأخر", StatusTone.Danger)
                else -> StatusChip("مفتوح", StatusTone.Warning)
            }
        }
        debt.description?.takeIf(String::isNotBlank)?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        LinearProgressIndicator(
            progress = { progress },
            modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            InfoStat("الإجمالي", total.display(), Modifier.weight(1f))
            InfoStat("المسدد", paid.display(), Modifier.weight(1f))
            InfoStat("المتبقي", remaining.display(), Modifier.weight(1f), emphasize = true)
        }
        Text(
            "تاريخ الاستحقاق: ${debt.dueDate?.toShortDate() ?: "غير محدد"}",
            style = MaterialTheme.typography.labelSmall,
            color = if (isOverdue) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (canManage) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (isOpen) {
                    CardActionButton("سداد دفعة", Icons.Filled.Payments, { onPay(debt) }, Modifier.weight(1f), ActionStyle.Filled)
                }
                CardActionButton("تعديل", Icons.Filled.Edit, { onEdit(debt) }, Modifier.weight(1f), ActionStyle.Tonal)
            }
            CardActionButton(
                label = if (paid.signum() > 0) "الحذف غير متاح: لديه دفعات" else "حذف الدين",
                icon = Icons.Filled.Delete,
                onClick = { onDelete(debt) },
                modifier = Modifier.fillMaxWidth(),
                style = ActionStyle.Danger,
                enabled = paid.signum() == 0 && debt.payments.isEmpty(),
            )
        }
    }
}

@Composable
internal fun PersonalDebtDetailsSheet(debt: PersonalDebtDto) {
    Column(
        Modifier.fillMaxWidth().heightIn(max = 640.dp).verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(debt.creditor, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        DetailLine("الحالة", debt.status.toArabicPersonalDebtStatus())
        DetailLine("الإجمالي", "${debt.totalAmount} ج.م")
        DetailLine("المسدد", "${debt.paidAmount} ج.م")
        DetailLine("المتبقي", "${debt.remaining} ج.م")
        DetailLine("تاريخ الاستحقاق", debt.dueDate?.toShortDate() ?: "غير محدد")
        debt.description?.takeIf(String::isNotBlank)?.let { DetailLine("الوصف", it) }
        debt.notes?.takeIf(String::isNotBlank)?.let {
            Text("ملاحظات", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text("سجل الدفعات", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        if (debt.payments.isEmpty()) {
            Text("لا توجد دفعات مسجلة بعد.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            debt.payments.forEach { payment ->
                Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceVariant) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("${payment.amount} ج.م", fontWeight = FontWeight.SemiBold)
                            Text(payment.paidOn?.toShortDate() ?: "غير محدد", style = MaterialTheme.typography.labelMedium)
                        }
                        payment.notes?.takeIf(String::isNotBlank)?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

internal fun invoiceStatusOptions(invoice: InvoiceDto, canPay: Boolean = true, canRefund: Boolean = true): List<ChoiceOption> {
    val remaining = invoice.remainingAmount.moneyOrZero()
    val refunded = invoice.status == "refunded"
    return listOf(
        ChoiceOption(
            value = "paid",
            label = "مدفوعة بالكامل",
            enabled = canPay && !refunded && remaining.signum() > 0,
            hint = when {
                refunded -> "الفاتورة مستردة"
                remaining.signum() <= 0 -> "الفاتورة مدفوعة بالفعل"
                else -> "تسجيل المتبقي ${remaining.display()} ج.م كدفعة"
            },
        ),
        ChoiceOption(
            value = "refunded",
            label = "مستردة",
            enabled = canRefund && !refunded,
            hint = if (refunded) "تم الاسترداد من قبل" else "إرجاع المنتجات للمخزون وإغلاق أقساطها",
        ),
    )
}

@Composable
internal fun InvoicesScreen(
    state: RemotePage<InvoiceDto>,
    query: String,
    canPay: Boolean,
    canRefund: Boolean,
    canEdit: Boolean,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onInvoiceClick: (InvoiceDto) -> Unit,
    onPay: (InvoiceDto) -> Unit,
    onChangeStatus: (InvoiceDto) -> Unit,
    onEdit: (InvoiceDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        state.error?.let { ErrorBanner(it) }
        when {
            state.isLoading && state.items.isEmpty() -> LoadingRow()
            state.items.isEmpty() -> EmptyState(if (state.error != null) "تعذر تحميل الفواتير" else "لا توجد فواتير")
            else -> LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.items, key = InvoiceDto::id) { invoice ->
                    InvoiceCard(invoice, canPay, canRefund, canEdit, onInvoiceClick, onPay, onChangeStatus, onEdit)
                }
                item { LoadMoreButton(state, onLoadMore) }
            }
        }
    }
}

@Composable
private fun InvoiceCard(
    invoice: InvoiceDto,
    canPay: Boolean,
    canRefund: Boolean,
    canEdit: Boolean,
    onClick: (InvoiceDto) -> Unit,
    onPay: (InvoiceDto) -> Unit,
    onChangeStatus: (InvoiceDto) -> Unit,
    onEdit: (InvoiceDto) -> Unit,
) {
    val refunded = invoice.status == "refunded"
    val remaining = invoice.remainingAmount.moneyOrZero()
    val tone = when {
        refunded -> StatusTone.Neutral
        invoice.status == "paid" -> StatusTone.Positive
        else -> StatusTone.Warning
    }
    ManagedCard(onClick = { onClick(invoice) }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("فاتورة ${invoice.invoiceNumber}", modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.width(8.dp))
            StatusChip(invoice.status.toArabicInvoiceStatus(), tone)
        }
        Text(invoice.customer, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            InfoStat("التاريخ", invoice.invoiceDate.toShortDate(), Modifier.weight(1.3f))
            InfoStat("الإجمالي", invoice.totalAmount, Modifier.weight(1f))
            InfoStat("المتبقي", remaining.display(), Modifier.weight(1f), emphasize = remaining.signum() > 0)
        }
        if ((canPay || canRefund || canEdit) && !refunded) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (canPay && remaining.signum() > 0) {
                    CardActionButton("دفعة", Icons.Filled.Payments, { onPay(invoice) }, Modifier.weight(1f), ActionStyle.Filled)
                }
                if (canPay || canRefund) {
                    CardActionButton("الحالة", Icons.Filled.SwapHoriz, { onChangeStatus(invoice) }, Modifier.weight(1f), ActionStyle.Tonal)
                }
                if (canEdit) {
                    CardActionButton("تعديل", Icons.Filled.Edit, { onEdit(invoice) }, Modifier.weight(1f))
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

private fun String.maintenanceTone(): StatusTone = when (this) {
    "مكتمل" -> StatusTone.Positive
    "قيد الصيانة" -> StatusTone.Warning
    "مرفوض" -> StatusTone.Danger
    else -> StatusTone.Neutral
}

@Composable
internal fun MaintenanceScreen(
    state: RemotePage<MaintenanceDto>,
    query: String,
    canManage: Boolean,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onChangeStatus: (MaintenanceDto) -> Unit,
    onEdit: (MaintenanceDto) -> Unit,
    onDelete: (MaintenanceDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        state.error?.let { ErrorBanner(it) }
        when {
            state.isLoading && state.items.isEmpty() -> LoadingRow()
            state.items.isEmpty() -> EmptyState(if (state.error != null) "تعذر تحميل سجل الصيانة" else "لا توجد طلبات صيانة")
            else -> LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.items, key = MaintenanceDto::id) { record ->
                    ManagedCard {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                record.name,
                                modifier = Modifier.weight(1f),
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Spacer(Modifier.width(8.dp))
                            StatusChip(record.status, record.status.maintenanceTone())
                        }
                        Text(
                            listOfNotNull(record.owner, record.phone?.takeIf(String::isNotBlank)).joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        record.address?.takeIf(String::isNotBlank)?.let {
                            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        record.description?.takeIf(String::isNotBlank)?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium)
                        }
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            InfoStat("تاريخ الاستلام", record.requestedDate.toShortDate(), Modifier.weight(1f))
                            record.completedDate?.let { InfoStat("تاريخ الإنجاز", it.toShortDate(), Modifier.weight(1f)) }
                        }
                        if (canManage) {
                            CardActionButton(
                                label = "تغيير حالة الجهاز",
                                icon = Icons.Filled.SwapHoriz,
                                onClick = { onChangeStatus(record) },
                                modifier = Modifier.fillMaxWidth(),
                                style = ActionStyle.Filled,
                            )
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                CardActionButton("تعديل", Icons.Filled.Edit, { onEdit(record) }, Modifier.weight(1f))
                                CardActionButton("حذف", Icons.Filled.Delete, { onDelete(record) }, Modifier.weight(1f), ActionStyle.Danger)
                            }
                        }
                    }
                }
                item { LoadMoreButton(state, onLoadMore) }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Damaged items ("الهالك")
// ---------------------------------------------------------------------------

@Composable
internal fun DamagedScreen(
    state: RemotePage<DamagedItemDto>,
    statusFilter: String?,
    onStatusChange: (String?) -> Unit,
    canManage: Boolean,
    query: String,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onDetails: (DamagedItemDto) -> Unit,
    onEdit: (DamagedItemDto) -> Unit,
    onDelete: (DamagedItemDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = statusFilter == null, onClick = { onStatusChange(null) }, label = { Text("الكل") })
            FilterChip(selected = statusFilter == "recorded", onClick = { onStatusChange("recorded") }, label = { Text("مسجل") })
            FilterChip(selected = statusFilter == "voided", onClick = { onStatusChange("voided") }, label = { Text("ملغى") })
        }
        state.error?.let { ErrorBanner(it) }
        when {
            state.isLoading && state.items.isEmpty() -> LoadingRow()
            state.items.isEmpty() -> EmptyState(if (state.error == null) "لا توجد سجلات هالك" else "تعذر تحميل سجل الهالك")
            else -> {
                val active = state.items.filter { it.status == "recorded" }
                val loss = active.mapNotNull { it.totalValue?.takeIf(String::isNotBlank) }
                    .takeIf { active.isNotEmpty() && it.size == active.size }
                    ?.fold(BigDecimal.ZERO) { sum, value -> sum + value.moneyOrZero() }
                val units = active.sumOf { it.quantity }
                LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 96.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            loss?.let { SummaryTile("قيمة الهالك (المسجل)", "${it.display()} ج.م", Modifier.weight(1f), StatusTone.Danger) }
                            SummaryTile("الوحدات", units.toString(), Modifier.weight(0.6f))
                        }
                    }
                    items(state.items, key = DamagedItemDto::id) { item ->
                        DamagedCard(item, canManage, onDetails, onEdit, onDelete)
                    }
                    item { LoadMoreButton(state, onLoadMore) }
                }
            }
        }
    }
}

@Composable
private fun DamagedCard(
    item: DamagedItemDto,
    canManage: Boolean,
    onDetails: (DamagedItemDto) -> Unit,
    onEdit: (DamagedItemDto) -> Unit,
    onDelete: (DamagedItemDto) -> Unit,
) {
    val voided = item.status == "voided"
    ManagedCard(onClick = { onDetails(item) }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(
                item.productName,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.width(8.dp))
            StatusChip(item.status.toArabicDamagedStatus(), if (voided) StatusTone.Neutral else StatusTone.Danger)
        }
        Text(
            "${item.reasonLabel} · ${item.damagedOn.toShortDate()}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            InfoStat("الكمية", item.quantity.toString(), Modifier.weight(1f))
            item.totalValue?.takeIf(String::isNotBlank)?.let { InfoStat("القيمة", "$it ج.م", Modifier.weight(1.3f), emphasize = !voided) }
            InfoStat("المخزون", "${item.stockBefore} ← ${item.stockAfter}", Modifier.weight(1f))
        }
        item.notes?.takeIf(String::isNotBlank)?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (voided) {
            item.voidReason?.takeIf(String::isNotBlank)?.let {
                Text("سبب الإلغاء: $it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            CardActionButton("التفاصيل", Icons.Filled.Info, { onDetails(item) }, Modifier.weight(1f))
            if (canManage && !voided) {
                CardActionButton("تعديل", Icons.Filled.Edit, { onEdit(item) }, Modifier.weight(1f), ActionStyle.Tonal)
                CardActionButton("حذف", Icons.Filled.Delete, { onDelete(item) }, Modifier.weight(1f), ActionStyle.Danger)
            }
        }
    }
}

@Composable
internal fun DamagedDetailsSheet(item: DamagedItemDto) {
    Column(
        Modifier.fillMaxWidth().heightIn(max = 640.dp).verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(item.productName, modifier = Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            StatusChip(item.status.toArabicDamagedStatus(), if (item.status == "voided") StatusTone.Neutral else StatusTone.Danger)
        }
        DetailLine("رقم السجل", "#${item.id}")
        item.productBarcode?.takeIf(String::isNotBlank)?.let { DetailLine("الباركود", it) }
        DetailLine("السبب", item.reasonLabel)
        DetailLine("الكمية", item.quantity.toString())
        item.unitValue?.takeIf(String::isNotBlank)?.let { DetailLine("قيمة الوحدة", "$it ج.م") }
        item.totalValue?.takeIf(String::isNotBlank)?.let { DetailLine("إجمالي القيمة", "$it ج.م") }
        DetailLine("تاريخ الهالك", item.damagedOn.toShortDate())
        DetailLine("المخزون قبل / بعد", "${item.stockBefore} ← ${item.stockAfter}")
        item.notes?.takeIf(String::isNotBlank)?.let {
            Text("ملاحظات", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (item.status == "voided") {
            Text("سبب الإلغاء", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(item.voidReason?.takeIf(String::isNotBlank) ?: "غير محدد", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
internal fun DamagedItemEditDialog(
    item: DamagedItemDto,
    canManageCost: Boolean,
    onDismiss: () -> Unit,
    onSave: (DamagedItemInputDto, String) -> Unit,
) {
    var quantity by rememberSaveable(item.id) { mutableStateOf(item.quantity.toString()) }
    var reason by rememberSaveable(item.id) { mutableStateOf(item.reason) }
    var unitValue by rememberSaveable(item.id, canManageCost) { mutableStateOf(if (canManageCost) item.unitValue.orEmpty() else "") }
    var damagedOn by rememberSaveable(item.id) { mutableStateOf(item.damagedOn.take(10)) }
    var notes by rememberSaveable(item.id) { mutableStateOf(item.notes.orEmpty()) }
    var reasonMenuOpen by remember { mutableStateOf(false) }
    var validationError by remember { mutableStateOf<String?>(null) }
    var requestKey by remember(item.id) { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember(item.id) { mutableStateOf<String?>(null) }

    fun payload(
        nextQuantity: String = quantity,
        nextReason: String = reason,
        nextUnitValue: String = unitValue,
        nextDamagedOn: String = damagedOn,
        nextNotes: String = notes,
    ) = listOf(nextQuantity, nextReason, nextUnitValue, nextDamagedOn, nextNotes).joinToString("\u0000")

    fun rotateKeyIfChanged(nextPayload: String) {
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("تعديل سجل الهالك") },
        text = {
            DialogForm(maxHeight = 560.dp) {
                Text(
                    "المنتج: ${item.productName}. تغيير الكمية يعدّل المخزون تلقائياً بالفرق.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = quantity,
                    onValueChange = { value ->
                        val normalized = value.normalizeArabicDigits().filter(Char::isDigit)
                        rotateKeyIfChanged(payload(nextQuantity = normalized))
                        quantity = normalized
                    },
                    label = { Text("الكمية التالفة") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Box {
                    OutlinedButton(onClick = { reasonMenuOpen = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(DamagedReasonOptions.firstOrNull { it.first == reason }?.second ?: reason)
                    }
                    DropdownMenu(expanded = reasonMenuOpen, onDismissRequest = { reasonMenuOpen = false }) {
                        DamagedReasonOptions.forEach { (key, label) ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = {
                                    rotateKeyIfChanged(payload(nextReason = key))
                                    reason = key
                                    reasonMenuOpen = false
                                },
                            )
                        }
                    }
                }
                if (canManageCost) OutlinedTextField(
                    value = unitValue,
                    onValueChange = { value ->
                        val normalized = value.normalizeArabicDigits()
                        rotateKeyIfChanged(payload(nextUnitValue = normalized))
                        unitValue = normalized
                    },
                    label = { Text("قيمة الوحدة") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = damagedOn,
                    onValueChange = { value ->
                        val normalized = value.normalizeArabicDigits()
                        rotateKeyIfChanged(payload(nextDamagedOn = normalized))
                        damagedOn = normalized
                    },
                    label = { Text("تاريخ الهالك (سنة-شهر-يوم)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes,
                    onValueChange = { rotateKeyIfChanged(payload(nextNotes = it)); notes = it },
                    label = { Text("ملاحظات (اختياري)") },
                    modifier = Modifier.fillMaxWidth(),
                )
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                val count = quantity.toIntOrNull()
                when {
                    count == null || count < 1 -> validationError = "أدخل كمية موجبة."
                    unitValue.isNotBlank() && !unitValue.isValidPaidAmount() -> validationError = "قيمة الوحدة غير صحيحة."
                    !damagedOn.isValidInvoiceDate() -> validationError = "أدخل تاريخاً صحيحاً بصيغة سنة-شهر-يوم."
                    else -> {
                        validationError = null
                        attemptedPayload = payload()
                        onSave(
                            DamagedItemInputDto(
                                productId = item.productId,
                                quantity = count,
                                reason = reason,
                                unitValue = unitValue.ifBlank { null },
                                damagedOn = damagedOn,
                                notes = notes.trim().ifBlank { null },
                            ),
                            requestKey,
                        )
                    }
                }
            }) { Text("حفظ التعديلات") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

// ---------------------------------------------------------------------------
// Home dashboard
// ---------------------------------------------------------------------------

/** True while any write is in flight; confirm buttons read it to block accidental double submits. */
internal val LocalIsSaving = compositionLocalOf { false }

internal data class DashboardMetric(
    val label: String,
    val value: String,
    val icon: ImageVector,
    val tone: StatusTone = StatusTone.Neutral,
    val onClick: (() -> Unit)? = null,
)

internal data class DashboardAlert(
    val title: String,
    val detail: String,
    val tone: StatusTone,
    val icon: ImageVector,
    val onClick: () -> Unit,
)

internal data class QuickAction(
    val label: String,
    val icon: ImageVector,
    val onClick: () -> Unit,
)

@Composable
private fun toneContainer(tone: StatusTone): Color = when (tone) {
    StatusTone.Positive -> MaterialTheme.colorScheme.primaryContainer
    StatusTone.Warning -> MaterialTheme.colorScheme.secondaryContainer
    StatusTone.Danger -> MaterialTheme.colorScheme.errorContainer
    StatusTone.Neutral -> MaterialTheme.colorScheme.surfaceVariant
}

@Composable
private fun toneContent(tone: StatusTone): Color = when (tone) {
    StatusTone.Positive -> MaterialTheme.colorScheme.onPrimaryContainer
    StatusTone.Warning -> MaterialTheme.colorScheme.onSecondaryContainer
    StatusTone.Danger -> MaterialTheme.colorScheme.onErrorContainer
    StatusTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
}

private fun greetingForNow(): String {
    val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
    return when {
        hour in 5..11 -> "صباح الخير"
        hour in 12..17 -> "طاب يومك"
        else -> "مساء الخير"
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
}

@Composable
internal fun HomeDashboardScreen(
    userName: String,
    isLoading: Boolean,
    metrics: List<DashboardMetric>,
    alerts: List<DashboardAlert>,
    quickActions: List<QuickAction>,
    modifier: Modifier = Modifier,
) {
    val today = remember { SimpleDateFormat("EEEE d MMMM yyyy", Locale.forLanguageTag("ar")).format(Date()) }
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("${greetingForNow()}، $userName", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(today, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (quickActions.isNotEmpty()) {
            SectionTitle("إجراءات سريعة")
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                quickActions.forEach { action ->
                    Surface(
                        onClick = action.onClick,
                        shape = RoundedCornerShape(16.dp),
                        color = MaterialTheme.colorScheme.primaryContainer,
                        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.width(92.dp),
                    ) {
                        Column(
                            Modifier.padding(horizontal = 8.dp, vertical = 14.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(action.icon, contentDescription = null, modifier = Modifier.size(26.dp))
                            Text(
                                action.label,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                                textAlign = TextAlign.Center,
                                maxLines = 2,
                            )
                        }
                    }
                }
            }
        }
        SectionTitle("ملخص سريع")
        metrics.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                pair.forEach { metric ->
                    Box(Modifier.weight(1f)) {
                        ManagedCard(onClick = metric.onClick) {
                            Surface(shape = CircleShape, color = toneContainer(metric.tone), contentColor = toneContent(metric.tone)) {
                                Icon(metric.icon, contentDescription = null, modifier = Modifier.padding(8.dp).size(20.dp))
                            }
                            Text(metric.value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(metric.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
        SectionTitle("يحتاج انتباهك")
        if (alerts.isEmpty()) {
            ManagedCard {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text(
                        if (isLoading) "جارٍ تحديث البيانات..." else "كل شيء على ما يرام، لا توجد تنبيهات حالياً.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            alerts.forEach { alert ->
                ManagedCard(onClick = alert.onClick) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Surface(shape = CircleShape, color = toneContainer(alert.tone), contentColor = toneContent(alert.tone)) {
                            Icon(alert.icon, contentDescription = null, modifier = Modifier.padding(8.dp).size(20.dp))
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(alert.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            Text(alert.detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

internal data class DashboardStats(
    val outOfStock: Int = 0,
    val lowStock: Int = 0,
    val overdueInstallmentCount: Int = 0,
    val overdueInstallmentsTotal: BigDecimal = BigDecimal.ZERO,
    val customerOutstanding: BigDecimal = BigDecimal.ZERO,
    val myDebtsOutstanding: BigDecimal = BigDecimal.ZERO,
    val overdueDebtsCount: Int = 0,
    val pendingMaintenance: Int = 0,
    val unpaidInvoices: Int = 0,
)

/** One pass over each list; callers memoise it so recomposition does not repeat the work. */
internal fun computeDashboardStats(
    products: List<CachedProduct>,
    installments: List<InstallmentDto>,
    debts: List<PersonalDebtDto>,
    maintenances: List<MaintenanceDto>,
    invoices: List<InvoiceDto>,
    today: String,
): DashboardStats {
    var outOfStock = 0
    var lowStock = 0
    products.forEach { if (it.stock <= 0) outOfStock++ else if (it.stock <= 5) lowStock++ }

    var overdueCount = 0
    var overdueTotal = BigDecimal.ZERO
    var customerTotal = BigDecimal.ZERO
    installments.forEach {
        val remaining = it.remaining.moneyOrZero()
        customerTotal += remaining
        if (it.status.toArabicInstallmentStatus() == "متأخر") {
            overdueCount++
            overdueTotal += remaining
        }
    }

    var owed = BigDecimal.ZERO
    var overdueDebts = 0
    debts.forEach {
        if (it.status == "open") {
            owed += it.remaining.moneyOrZero()
            if (it.dueDate != null && it.dueDate < today) overdueDebts++
        }
    }

    return DashboardStats(
        outOfStock = outOfStock,
        lowStock = lowStock,
        overdueInstallmentCount = overdueCount,
        overdueInstallmentsTotal = overdueTotal,
        customerOutstanding = customerTotal,
        myDebtsOutstanding = owed,
        overdueDebtsCount = overdueDebts,
        pendingMaintenance = maintenances.count { it.status == "قيد الانتظار" || it.status == "قيد الصيانة" },
        unpaidInvoices = invoices.count { it.status != "paid" && it.status != "refunded" },
    )
}
