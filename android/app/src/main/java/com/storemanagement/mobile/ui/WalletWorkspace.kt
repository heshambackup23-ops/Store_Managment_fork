package com.storemanagement.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Store
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.util.Locale

internal const val walletWorkspaceTitle = "إدارة المحافظ والتحويلات"

internal enum class WalletService(val label: String, vararg aliases: String) {
    Vodafone("فودافون كاش", "vodafone_cash", "vodafonecash", "فودافون كاش", "فودافون"),
    Fawry("فوري", "fawry", "fawry_pay", "fawrypay", "فوري", "فورى", "فوري باي"),
    InstaPay("إنستا باي", "instapay", "insta_pay", "إنستا باي", "انستا باي", "إنستاباي", "انستاباي");

    val key: String = aliases.first()
    private val normalizedAliases = aliases.map(String::normalizedProvider).toSet()

    fun matches(provider: String?) = provider != null && provider.normalizedProvider() in normalizedAliases
}

private fun String.normalizedProvider() = trim().lowercase(Locale.ROOT).replace(Regex("[\\s_-]+"), "")

internal fun walletProviderDisplay(provider: String): String =
    WalletService.entries.firstOrNull { it.matches(provider) }?.label ?: provider

@Composable
internal fun WalletWorkspaceScreen(
    canReadBalances: Boolean,
    canReadTransfers: Boolean,
    canOpenPointOfSale: Boolean,
    onBalances: () -> Unit,
    onTransfers: () -> Unit,
    onProvider: (WalletService) -> Unit,
    onInstaPaySale: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("المحافظ المسجّلة", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)
        if (canReadTransfers) MoreActionRow(
            "كاشير المحافظ", "الإيداع والسحب والتحصيل الآجل", Icons.Filled.Payments, onTransfers,
        )
        if (canReadBalances) MoreActionRow(
            "أرصدة المحافظ وحدودها", "رصيد المزود والاستخدام المسجّل", Icons.Filled.AccountBalanceWallet, onBalances,
        )
        MoreActionRow("فودافون كاش", "عرض سجلات فودافون كاش في هلال", Icons.Filled.AccountBalanceWallet,
            { onProvider(WalletService.Vodafone) }, Modifier.testTag("wallet-provider-vodafone"))
        MoreActionRow("فوري", "عرض سجلات فوري في هلال", Icons.Filled.AccountBalanceWallet,
            { onProvider(WalletService.Fawry) }, Modifier.testTag("wallet-provider-fawry"))
        MoreActionRow("سجل إنستا باي", "عرض المحافظ المسجّلة سابقًا", Icons.Filled.AccountBalanceWallet,
            { onProvider(WalletService.InstaPay) }, Modifier.testTag("wallet-provider-instapay"))
        if (canOpenPointOfSale) MoreActionRow(
            "تحصيل بيع عبر إنستا باي", "بعد تأكيد الدفع، سجّل المبلغ والمرجع كتحويل بنكي من نقطة البيع",
            Icons.Filled.Store, onInstaPaySale, Modifier.testTag("wallet-instapay-sale"),
        )
    }
}
