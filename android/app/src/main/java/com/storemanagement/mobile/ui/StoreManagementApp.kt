package com.storemanagement.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import com.storemanagement.mobile.core.network.ConnectionStatus
import com.storemanagement.mobile.core.network.ConnectionState
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.Lifecycle
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.Close
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Store
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Button
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.storemanagement.mobile.R
import com.storemanagement.mobile.core.database.CachedCategory
import com.storemanagement.mobile.core.database.CachedProduct
import com.storemanagement.mobile.core.network.CustomerDto
import com.storemanagement.mobile.core.network.CustomerInputDto
import com.storemanagement.mobile.core.network.CategoryInputDto
import com.storemanagement.mobile.core.network.CategoryDto
import com.storemanagement.mobile.core.network.ApiResult
import com.storemanagement.mobile.core.network.InvoiceDto
import com.storemanagement.mobile.core.network.InvoiceInputDto
import com.storemanagement.mobile.core.network.InstallmentDto
import com.storemanagement.mobile.core.network.InstallmentInputDto
import com.storemanagement.mobile.core.network.PayAmountInputDto
import com.storemanagement.mobile.core.network.PersonalDebtDto
import com.storemanagement.mobile.core.network.DamagedItemDto
import com.storemanagement.mobile.core.network.ProductDto
import com.storemanagement.mobile.core.network.SupplierDto
import com.storemanagement.mobile.core.network.SupplierInputDto
import com.storemanagement.mobile.core.network.SoldProductDto
import com.storemanagement.mobile.core.network.NotificationDto
import com.storemanagement.mobile.core.network.MaintenanceDto
import com.storemanagement.mobile.core.network.MaintenanceInputDto
import com.storemanagement.mobile.core.network.UserDto
import com.storemanagement.mobile.core.network.WalletDto
import com.storemanagement.mobile.core.network.WalletOverviewDto
import com.storemanagement.mobile.core.network.WalletCashierInputDto
import com.storemanagement.mobile.core.network.WalletCashierTransactionDto
import com.storemanagement.mobile.core.network.SettleWalletTransactionInputDto
import com.storemanagement.mobile.core.network.ReverseWalletTransactionInputDto
import com.storemanagement.mobile.core.network.CashierCheckoutInputDto
import com.storemanagement.mobile.core.network.CashierCheckoutItemDto
import com.storemanagement.mobile.core.network.CashierCheckoutResponseDto
import com.storemanagement.mobile.core.network.CashierProductDto
import com.storemanagement.mobile.ui.theme.StoreTheme
import coil3.compose.AsyncImage
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import java.util.UUID
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun StoreManagementApp(
    sessionViewModel: SessionViewModel = hiltViewModel(),
    storeViewModel: StoreViewModel = hiltViewModel(),
    connectionViewModel: ConnectionViewModel = hiltViewModel(),
) {
    val session by sessionViewModel.state.collectAsStateWithLifecycle()
    val connection by connectionViewModel.state.collectAsStateWithLifecycle()
    val isSaving by storeViewModel.isSaving.collectAsStateWithLifecycle()
    val currentUser = session.user

    LifecycleEventEffect(Lifecycle.Event.ON_START) { connectionViewModel.resume() }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { connectionViewModel.pause() }

    StoreTheme(darkTheme = false) {
        CompositionLocalProvider(LocalIsSaving provides isSaving) {
            Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                when {
                    session.isRestoring -> LoadingScreen()
                    currentUser == null -> Column(Modifier.fillMaxSize().statusBarsPadding()) {
                        ConnectionBanner(connection, connectionViewModel::checkNow)
                        Box(Modifier.weight(1f)) {
                            LoginScreen(
                                error = session.error,
                                isSubmitting = session.isSubmitting,
                                onLogin = sessionViewModel::login,
                                onRetry = {
                                    connectionViewModel.checkNow()
                                    sessionViewModel.restoreSession()
                                },
                            )
                        }
                    }
                    else -> StoreHomeScreen(
                        user = currentUser,
                        storeViewModel = storeViewModel,
                        connection = connection,
                        onCheckConnection = connectionViewModel::checkNow,
                        onLogout = sessionViewModel::logout,
                        onSessionExpired = sessionViewModel::expireSession,
                    )
                }
            }
        }
    }
}

@Composable
private fun LoadingScreen() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun LoginScreen(
    error: String?,
    isSubmitting: Boolean,
    onLogin: (String, String) -> Unit,
    onRetry: () -> Unit,
) {
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var showPassword by rememberSaveable { mutableStateOf(false) }
    val passwordFocusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    val submitLogin = {
        if (!isSubmitting) {
            keyboardController?.hide()
            onLogin(username, password)
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = maxHeight)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
        Surface(
            color = MaterialTheme.colorScheme.primary,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.size(58.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Store, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary)
            }
        }
        Spacer(Modifier.height(24.dp))
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("سجّل الدخول للمتابعة", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(28.dp))
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("اسم المستخدم") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text, imeAction = ImeAction.Next),
            keyboardActions = KeyboardActions(onNext = { passwordFocusRequester.requestFocus() }),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("كلمة المرور") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submitLogin() }),
            visualTransformation = if (showPassword) androidx.compose.ui.text.input.VisualTransformation.None
            else PasswordVisualTransformation(),
            trailingIcon = {
                TextButton(onClick = { showPassword = !showPassword }) {
                    Text(if (showPassword) "إخفاء" else "إظهار")
                }
            },
            modifier = Modifier.fillMaxWidth().focusRequester(passwordFocusRequester),
        )
        if (error != null) {
            Spacer(Modifier.height(16.dp))
            Text(error, color = MaterialTheme.colorScheme.error)
            if (!isSubmitting) {
                TextButton(onClick = onRetry) { Text("إعادة الاتصال") }
            }
        }
        Spacer(Modifier.height(20.dp))
        androidx.compose.material3.Button(
            onClick = { submitLogin() },
            enabled = !isSubmitting,
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(vertical = 14.dp),
        ) {
            if (isSubmitting) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
            }
            Text("دخول")
        }
    }
    }
}

private enum class StoreTab(val label: String, val permission: String?, val icon: ImageVector) {
    Dashboard("الرئيسية", null, Icons.Filled.Store),
    Products("المنتجات", "page.products.view", Icons.Filled.Inventory2),
    Customers("العملاء", "page.customers.view", Icons.Filled.People),
    Invoices("الفواتير", "page.invoices.view", Icons.AutoMirrored.Filled.ReceiptLong),
    Installments("الأقساط والديون", "page.installments.view", Icons.Filled.Payments),
    More("المزيد", null, Icons.Filled.MoreHoriz),
}

private enum class MoreSection { Home, Categories, Customers, Sales, Suppliers, Installments, Wallets, WalletCashier, ProductCashier, Damaged, Notifications, Maintenance, Profile, Backup }
internal enum class CashierAction { Settle, Reverse }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StoreHomeScreen(
    user: UserDto,
    storeViewModel: StoreViewModel,
    connection: ConnectionState,
    onCheckConnection: () -> Unit,
    onLogout: () -> Unit,
    onSessionExpired: () -> Unit,
) {
    val isSaving by storeViewModel.isSaving.collectAsStateWithLifecycle()
    val products by storeViewModel.products.collectAsStateWithLifecycle()
    val cacheTime by storeViewModel.productCacheTime.collectAsStateWithLifecycle()
    val categories by storeViewModel.categories.collectAsStateWithLifecycle()
    val customers by storeViewModel.customers.collectAsStateWithLifecycle()
    val sales by storeViewModel.sales.collectAsStateWithLifecycle()
    val notifications by storeViewModel.notifications.collectAsStateWithLifecycle()
    val maintenances by storeViewModel.maintenances.collectAsStateWithLifecycle()
    val invoices by storeViewModel.invoices.collectAsStateWithLifecycle()
    val suppliers by storeViewModel.suppliers.collectAsStateWithLifecycle()
    val installments by storeViewModel.installments.collectAsStateWithLifecycle()
    val personalDebts by storeViewModel.personalDebts.collectAsStateWithLifecycle()
    val walletState by storeViewModel.walletOverview.collectAsStateWithLifecycle()
    val walletCashierState by storeViewModel.walletCashier.collectAsStateWithLifecycle()
    val cashierPosState by storeViewModel.cashierPos.collectAsStateWithLifecycle()
    val profileState by storeViewModel.profile.collectAsStateWithLifecycle()
    val damagedItems by storeViewModel.damagedItems.collectAsStateWithLifecycle()
    val damagedProductsState by storeViewModel.damagedProducts.collectAsStateWithLifecycle()
    val productPage by storeViewModel.productPage.collectAsStateWithLifecycle()
    val productDetails by storeViewModel.productDetails.collectAsStateWithLifecycle()
    val invoiceDetails by storeViewModel.invoiceDetails.collectAsStateWithLifecycle()
    val invoicePdfState by storeViewModel.invoicePdfState.collectAsStateWithLifecycle()
    val supplierDetails by storeViewModel.supplierDetails.collectAsStateWithLifecycle()
    val installmentDetails by storeViewModel.installmentDetails.collectAsStateWithLifecycle()
    val categoryPage by storeViewModel.categoryPage.collectAsStateWithLifecycle()
    val categoryDetails by storeViewModel.categoryDetails.collectAsStateWithLifecycle()
    val customerDetails by storeViewModel.customerDetails.collectAsStateWithLifecycle()
    val productError by storeViewModel.productError.collectAsStateWithLifecycle()
    val categoryError by storeViewModel.categoryError.collectAsStateWithLifecycle()
    val snackbars = remember { SnackbarHostState() }
    var editor by remember { mutableStateOf<EditTarget?>(null) }
    var deleteTarget by remember { mutableStateOf<DeleteTarget?>(null) }
    var invoiceDialogOpen by remember { mutableStateOf(false) }
    var productDialogOpen by remember { mutableStateOf(false) }
    var productEditTarget by remember { mutableStateOf<CachedProduct?>(null) }
    var productDeleteTarget by remember { mutableStateOf<CachedProduct?>(null) }
    var damagedDialogOpen by remember { mutableStateOf(false) }
    var damagedVoidTarget by remember { mutableStateOf<DamagedItemDto?>(null) }
    var profileEditOpen by remember { mutableStateOf(false) }
    var supplierDialogOpen by remember { mutableStateOf(false) }
    var supplierEditTarget by remember { mutableStateOf<SupplierDto?>(null) }
    var supplierDeleteTarget by remember { mutableStateOf<SupplierDto?>(null) }
    var installmentDialogOpen by remember { mutableStateOf(false) }
    var installmentEditTarget by remember { mutableStateOf<InstallmentDto?>(null) }
    var paymentInstallmentTarget by remember { mutableStateOf<InstallmentDto?>(null) }
    var personalDebtDialogOpen by remember { mutableStateOf(false) }
    var personalDebtEditTarget by remember { mutableStateOf<PersonalDebtDto?>(null) }
    var paymentPersonalDebtTarget by remember { mutableStateOf<PersonalDebtDto?>(null) }
    var personalDebtDeleteTarget by remember { mutableStateOf<PersonalDebtDto?>(null) }
    var debtsSection by rememberSaveable { mutableStateOf("customers") }
    var invoiceEditTarget by remember { mutableStateOf<InvoiceDto?>(null) }
    var paymentInvoiceTarget by remember { mutableStateOf<InvoiceDto?>(null) }
    var invoiceStatusTarget by remember { mutableStateOf<InvoiceDto?>(null) }
    var invoiceRefundTarget by remember { mutableStateOf<InvoiceDto?>(null) }
    var installmentStatusTarget by remember { mutableStateOf<InstallmentDto?>(null) }
    var maintenanceStatusTarget by remember { mutableStateOf<MaintenanceDto?>(null) }
    var damagedEditTarget by remember { mutableStateOf<DamagedItemDto?>(null) }
    var selectedDamaged by remember { mutableStateOf<DamagedItemDto?>(null) }
    var selectedPersonalDebt by remember { mutableStateOf<PersonalDebtDto?>(null) }
    var damagedStatusFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var walletDialogOpen by remember { mutableStateOf(false) }
    var walletAdjustmentTarget by remember { mutableStateOf<WalletDto?>(null) }
    var maintenanceDialogOpen by remember { mutableStateOf(false) }
    var maintenanceEditTarget by remember { mutableStateOf<MaintenanceDto?>(null) }
    var maintenanceDeleteTarget by remember { mutableStateOf<MaintenanceDto?>(null) }
    var walletCashierDialogOpen by remember { mutableStateOf(false) }
    var cashierActionTarget by remember { mutableStateOf<WalletCashierTransactionDto?>(null) }
    var cashierAction by remember { mutableStateOf<CashierAction?>(null) }
    var selectedProduct by remember { mutableStateOf<CachedProduct?>(null) }
    var selectedInvoice by remember { mutableStateOf<InvoiceDto?>(null) }
    var selectedSupplier by remember { mutableStateOf<SupplierDto?>(null) }
    var selectedInstallment by remember { mutableStateOf<InstallmentDto?>(null) }
    var selectedCategory by remember { mutableStateOf<CachedCategory?>(null) }
    var selectedCustomer by remember { mutableStateOf<CustomerDto?>(null) }
    val availableTabs = remember(user.permissions) {
        StoreTab.entries.filter { it.permission == null || it.permission in user.permissions }
    }
    var selectedTab by rememberSaveable(user.id) { mutableStateOf(StoreTab.Dashboard.name) }
    var searchQuery by rememberSaveable { mutableStateOf("") }
    var backupPages by rememberSaveable { mutableStateOf(setOf("catalog", "customers", "sales", "invoices", "installments", "suppliers", "maintenance", "wallets", "damaged", "notifications", "team")) }
    val context = LocalContext.current
    var invoicePdfPendingId by remember { mutableStateOf<Long?>(null) }
    val invoicePdfPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        val invoiceId = invoicePdfPendingId
        invoicePdfPendingId = null
        if (uri != null && invoiceId != null) storeViewModel.downloadInvoicePdf(invoiceId, uri, context.contentResolver)
    }
    val backupExportPicker = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
        if (uri != null) storeViewModel.downloadBackup(backupPages.toList(), uri, context.contentResolver)
    }
    val backupImportPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) storeViewModel.importBackup(backupPages.toList(), uri, context.contentResolver, context.cacheDir)
    }
    val backupMessageHost = remember { SnackbarHostState() }
    LaunchedEffect(storeViewModel) { storeViewModel.backupMessage.collect { backupMessageHost.showSnackbar(it) } }
    var moreSectionName by rememberSaveable { mutableStateOf(MoreSection.Home.name) }
    val moreSection = MoreSection.entries.firstOrNull { it.name == moreSectionName } ?: MoreSection.Home
    var selectedProductCategoryId by rememberSaveable { mutableStateOf<Long?>(null) }
    var productStockFilter by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val activeTab = StoreTab.entries.firstOrNull { it.name == selectedTab && it in availableTabs }
        ?: StoreTab.Dashboard
    val activeTitle = if (activeTab == StoreTab.More && moreSection != MoreSection.Home) {
        when (moreSection) {
            MoreSection.Categories -> "التصنيفات"
            MoreSection.Customers -> "العملاء"
            MoreSection.Sales -> "المبيعات"
            MoreSection.Suppliers -> "الموردون"
            MoreSection.Installments -> "الأقساط والديون"
            MoreSection.Wallets -> "المحافظ"
            MoreSection.WalletCashier -> "كاشير المحافظ"
            MoreSection.ProductCashier -> "نقطة البيع"
            MoreSection.Damaged -> "الهالك"
            MoreSection.Notifications -> "الإشعارات"
            MoreSection.Maintenance -> "الصيانة"
            MoreSection.Profile -> "حسابي"
            MoreSection.Backup -> "النسخ الاحتياطي"
            MoreSection.Home -> "المزيد"
        }
    } else {
        activeTab.label
    }

    BackHandler(enabled = activeTab == StoreTab.More && moreSection != MoreSection.Home) {
        moreSectionName = MoreSection.Home.name
        searchQuery = ""
    }

    LaunchedEffect(user.id) {
        if ("page.products.view" in user.permissions) storeViewModel.refreshProducts(null)
        if ("page.categories.view" in user.permissions) storeViewModel.refreshCategories(null)
        if ("page.customers.view" in user.permissions) storeViewModel.refreshCustomers(null)
        if ("page.invoices.view" in user.permissions) storeViewModel.refreshInvoices(null)
        if ("page.wallets.view" in user.permissions) storeViewModel.refreshWalletOverview()
        storeViewModel.refreshProfile()
    }

    LaunchedEffect(storeViewModel) {
        storeViewModel.events.collectLatest { event ->
            when (event) {
                is StoreEvent.Saved -> {
                    editor = null
                    deleteTarget = null
                    invoiceDialogOpen = false
                    productDialogOpen = false
                    productEditTarget = null
                    productDeleteTarget = null
                    damagedDialogOpen = false
                    damagedVoidTarget = null
                    profileEditOpen = false
                    supplierDialogOpen = false
                    installmentDialogOpen = false
                    installmentEditTarget = null
                    paymentInstallmentTarget = null
                    personalDebtDialogOpen = false
                    personalDebtEditTarget = null
                    paymentPersonalDebtTarget = null
                    personalDebtDeleteTarget = null
                    invoiceEditTarget = null
                    paymentInvoiceTarget = null
                    invoiceStatusTarget = null
                    invoiceRefundTarget = null
                    installmentStatusTarget = null
                    maintenanceStatusTarget = null
                    damagedEditTarget = null
                    walletDialogOpen = false
                    walletAdjustmentTarget = null
                    maintenanceDialogOpen = false
                    maintenanceDeleteTarget = null
                    walletCashierDialogOpen = false
                    cashierActionTarget = null
                    cashierAction = null
                    snackbars.showSnackbar(event.message)
                }
                is StoreEvent.Failed -> snackbars.showSnackbar(event.message)
                StoreEvent.SessionExpired -> {
                    editor = null
                    deleteTarget = null
                    invoiceDialogOpen = false
                    productDialogOpen = false
                    productEditTarget = null
                    productDeleteTarget = null
                    damagedDialogOpen = false
                    damagedVoidTarget = null
                    profileEditOpen = false
                    supplierDialogOpen = false
                    installmentDialogOpen = false
                    installmentEditTarget = null
                    paymentInstallmentTarget = null
                    personalDebtDialogOpen = false
                    personalDebtEditTarget = null
                    paymentPersonalDebtTarget = null
                    personalDebtDeleteTarget = null
                    invoiceEditTarget = null
                    paymentInvoiceTarget = null
                    invoiceStatusTarget = null
                    invoiceRefundTarget = null
                    installmentStatusTarget = null
                    maintenanceStatusTarget = null
                    damagedEditTarget = null
                    walletDialogOpen = false
                    walletAdjustmentTarget = null
                    maintenanceDialogOpen = false
                    maintenanceDeleteTarget = null
                    walletCashierDialogOpen = false
                    cashierActionTarget = null
                    cashierAction = null
                    selectedProduct = null
                    selectedInvoice = null
                    selectedSupplier = null
                    selectedInstallment = null
                    selectedDamaged = null
                    selectedPersonalDebt = null
                    selectedCategory = null
                    selectedCustomer = null
                    storeViewModel.clearProductDetails()
                    storeViewModel.clearInvoiceDetails()
                    storeViewModel.clearSupplierDetails()
                    storeViewModel.clearInstallmentDetails()
                    storeViewModel.clearCategoryDetails()
                    storeViewModel.clearCustomerDetails()
                    onSessionExpired()
                }
            }
        }
    }

    val openTab: (StoreTab) -> Unit = { tab ->
        selectedTab = tab.name
        searchQuery = ""
        if (tab == StoreTab.More) moreSectionName = MoreSection.Home.name
    }
    val openSection: (MoreSection) -> Unit = { section ->
        selectedTab = StoreTab.More.name
        moreSectionName = section.name
        searchQuery = ""
    }

    BackHandler(enabled = activeTab != StoreTab.Dashboard && !(activeTab == StoreTab.More && moreSection != MoreSection.Home)) {
        openTab(StoreTab.Dashboard)
    }

    val dashboardLoadedAt = remember { LongArray(1) }
    val refreshCurrent: (Boolean) -> Unit = { force ->
        val query = searchQuery.ifBlank { null }
        when (activeTab) {
            StoreTab.Dashboard -> {
                // Reopening the dashboard must not refetch five lists every time.
                val now = System.currentTimeMillis()
                if (force || now - dashboardLoadedAt[0] > 60_000L) {
                    dashboardLoadedAt[0] = now
                    if ("page.products.view" in user.permissions) storeViewModel.refreshProducts(null)
                    if ("page.customers.view" in user.permissions) storeViewModel.refreshCustomers(null)
                    if ("page.invoices.view" in user.permissions) storeViewModel.refreshInvoices(null)
                    if ("page.installments.view" in user.permissions) {
                        storeViewModel.refreshInstallments(null)
                        storeViewModel.refreshPersonalDebts(null)
                    }
                    if ("page.maintenance.view" in user.permissions) storeViewModel.refreshMaintenances(null)
                }
            }
            StoreTab.Products -> storeViewModel.refreshProducts(
                query,
                categoryId = selectedProductCategoryId,
                inStock = productStockFilter,
            )
            StoreTab.Customers -> storeViewModel.refreshCustomers(query)
            StoreTab.Invoices -> storeViewModel.refreshInvoices(query)
            StoreTab.Installments -> {
                storeViewModel.refreshInstallments(query)
                storeViewModel.refreshPersonalDebts(query)
            }
            StoreTab.More -> when (moreSection) {
                MoreSection.Customers -> storeViewModel.refreshCustomers(query)
                MoreSection.Suppliers -> storeViewModel.refreshSuppliers(query)
                MoreSection.Installments -> {
                    storeViewModel.refreshInstallments(query)
                    storeViewModel.refreshPersonalDebts(query)
                }
                MoreSection.Sales -> storeViewModel.refreshSales(query)
                MoreSection.Notifications -> storeViewModel.refreshNotifications()
                MoreSection.Maintenance -> storeViewModel.refreshMaintenances(query)
                MoreSection.WalletCashier -> storeViewModel.refreshWalletCashier()
                MoreSection.ProductCashier -> storeViewModel.searchCashierProducts("")
                MoreSection.Damaged -> storeViewModel.refreshDamagedItems(query, damagedStatusFilter)
                else -> Unit
            }
        }
    }

    LaunchedEffect(activeTab, searchQuery, selectedProductCategoryId, productStockFilter, moreSection) {
        delay(300)
        refreshCurrent(false)
    }

    var wasDisconnected by remember { mutableStateOf(false) }
    val latestRefresh by rememberUpdatedState(refreshCurrent)
    LaunchedEffect(connection.status) {
        when {
            connection.status.isProblem() -> wasDisconnected = true
            connection.status == ConnectionStatus.Online && wasDisconnected -> {
                wasDisconnected = false
                latestRefresh(true)
            }
        }
    }

    var pullRefreshing by remember { mutableStateOf(false) }
    val pullScope = rememberCoroutineScope()


    val isDashboardTab = activeTab == StoreTab.Dashboard
    val todayIso = remember(isDashboardTab) { SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date()) }
    val stats = remember(isDashboardTab, products, installments.items, personalDebts.items, maintenances.items, invoices.items, todayIso) {
        if (isDashboardTab) {
            computeDashboardStats(products, installments.items, personalDebts.items, maintenances.items, invoices.items, todayIso)
        } else {
            DashboardStats()
        }
    }
    val outOfStockCount = stats.outOfStock
    val lowStockCount = stats.lowStock
    val overdueInstallmentCount = stats.overdueInstallmentCount
    val overdueInstallmentsTotal = stats.overdueInstallmentsTotal
    val customerOutstanding = stats.customerOutstanding
    val myDebtsOutstanding = stats.myDebtsOutstanding
    val overdueDebtsCount = stats.overdueDebtsCount
    val pendingMaintenanceCount = stats.pendingMaintenance
    val unpaidInvoicesCount = stats.unpaidInvoices
    val canViewInstallments = "page.installments.view" in user.permissions
    val canViewMaintenance = "page.maintenance.view" in user.permissions

    val dashboardMetrics = buildList {
        if (StoreTab.Products in availableTabs) add(DashboardMetric("المنتجات", products.size.toString(), Icons.Filled.Inventory2, StatusTone.Positive, onClick = { openTab(StoreTab.Products) }))
        if (StoreTab.Customers in availableTabs) add(DashboardMetric("العملاء", customers.total.toString(), Icons.Filled.People, StatusTone.Neutral, onClick = { openTab(StoreTab.Customers) }))
        if (StoreTab.Invoices in availableTabs) {
            add(DashboardMetric("الفواتير", invoices.total.toString(), Icons.AutoMirrored.Filled.ReceiptLong, StatusTone.Neutral, onClick = { openTab(StoreTab.Invoices) }))
            add(DashboardMetric("فواتير غير مسددة", unpaidInvoicesCount.toString(), Icons.Filled.Payments, if (unpaidInvoicesCount > 0) StatusTone.Warning else StatusTone.Positive, onClick = { openTab(StoreTab.Invoices) }))
        }
        if (canViewInstallments) {
            add(DashboardMetric("المتبقي على العملاء", "${customerOutstanding.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()} ج.م", Icons.Filled.Payments, StatusTone.Warning, onClick = { debtsSection = "customers"; openSection(MoreSection.Installments) }))
            add(DashboardMetric("المتبقي عليّ", "${myDebtsOutstanding.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()} ج.م", Icons.Filled.Payments, StatusTone.Danger, onClick = { debtsSection = "personal"; openSection(MoreSection.Installments) }))
        }
        if (canViewMaintenance) add(DashboardMetric("أجهزة قيد الصيانة", pendingMaintenanceCount.toString(), Icons.Filled.Build, StatusTone.Neutral, onClick = { openSection(MoreSection.Maintenance) }))
    }

    val dashboardAlerts = buildList {
        if (StoreTab.Products in availableTabs && outOfStockCount > 0) {
            add(DashboardAlert("منتجات نفدت من المخزون", "$outOfStockCount منتج بحاجة إلى إعادة توريد", StatusTone.Danger, Icons.Filled.Warning) { openTab(StoreTab.Products) })
        }
        if (StoreTab.Products in availableTabs && lowStockCount > 0) {
            add(DashboardAlert("مخزون منخفض", "$lowStockCount منتج متبقٍ منه 5 وحدات أو أقل", StatusTone.Warning, Icons.Filled.Inventory2) { openTab(StoreTab.Products) })
        }
        if (canViewInstallments && overdueInstallmentCount > 0) {
            add(DashboardAlert("أقساط عملاء متأخرة", "$overdueInstallmentCount قسط بإجمالي ${overdueInstallmentsTotal.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()} ج.م", StatusTone.Danger, Icons.Filled.Payments) { debtsSection = "customers"; openSection(MoreSection.Installments) })
        }
        if (canViewInstallments && overdueDebtsCount > 0) {
            add(DashboardAlert("ديون عليك متأخرة", "$overdueDebtsCount دين تجاوز تاريخ استحقاقه", StatusTone.Danger, Icons.Filled.Warning) { debtsSection = "personal"; openSection(MoreSection.Installments) })
        }
        if (StoreTab.Invoices in availableTabs && unpaidInvoicesCount > 0) {
            add(DashboardAlert("فواتير بانتظار السداد", "$unpaidInvoicesCount فاتورة لم تُسدد بالكامل", StatusTone.Warning, Icons.Filled.Payments) { openTab(StoreTab.Invoices) })
        }
        if (canViewMaintenance && pendingMaintenanceCount > 0) {
            add(DashboardAlert("أجهزة قيد المتابعة", "$pendingMaintenanceCount جهاز لم يكتمل بعد", StatusTone.Warning, Icons.Filled.Build) { openSection(MoreSection.Maintenance) })
        }
    }

    val quickActions = buildList {
        if ("page.invoices.manage" in user.permissions && "page.products.view" in user.permissions) {
            add(QuickAction("فاتورة جديدة", Icons.AutoMirrored.Filled.ReceiptLong) { storeViewModel.refreshProducts(null); invoiceDialogOpen = true })
        }
        if ("page.invoices.manage" in user.permissions) add(QuickAction("نقطة البيع", Icons.Filled.Store) { openSection(MoreSection.ProductCashier) })
        if ("page.products.manage" in user.permissions) add(QuickAction("منتج جديد", Icons.Filled.Inventory2) { productEditTarget = null; productDialogOpen = true })
        if ("page.customers.manage" in user.permissions) add(QuickAction("عميل جديد", Icons.Filled.People) { editor = EditTarget(EditKind.Customer) })
        if ("page.damaged.manage" in user.permissions) add(QuickAction("تسجيل هالك", Icons.Filled.Delete) { storeViewModel.searchDamagedProducts(null); damagedDialogOpen = true })
        if ("page.installments.manage" in user.permissions) add(QuickAction("دين عليّ", Icons.Filled.Payments) { personalDebtEditTarget = null; personalDebtDialogOpen = true })
        if ("page.maintenance.manage" in user.permissions) add(QuickAction("طلب صيانة", Icons.Filled.Build) { maintenanceEditTarget = null; maintenanceDialogOpen = true })
    }

    Scaffold(
        modifier = Modifier.fillMaxSize().imePadding(),
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Column {
                            Text(activeTitle, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(user.name, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    },
                    navigationIcon = {
                        if (activeTab == StoreTab.More && moreSection != MoreSection.Home) {
                            IconButton(onClick = {
                                moreSectionName = MoreSection.Home.name
                                searchQuery = ""
                            }) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "رجوع")
                            }
                        }
                    },
                    actions = {
                        ConnectionPill(connection, onCheckConnection)
                        IconButton(onClick = onLogout) {
                            Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "تسجيل الخروج")
                        }
                    },
                )
                ConnectionBanner(connection, onCheckConnection)
                if (isSaving) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        },
        snackbarHost = { SnackbarHost(snackbars) },
        floatingActionButton = {
            when {
                activeTab == StoreTab.Products && "page.products.manage" in user.permissions -> {
                    FloatingActionButton(onClick = { productEditTarget = null; productDialogOpen = true }) {
                        Icon(Icons.Filled.Add, contentDescription = "إضافة منتج")
                    }
                }
                activeTab == StoreTab.More && moreSection == MoreSection.Categories && "page.categories.manage" in user.permissions -> {
                    FloatingActionButton(onClick = { editor = EditTarget(EditKind.Category) }) {
                        Icon(Icons.Filled.Add, contentDescription = "إضافة تصنيف")
                    }
                }
                activeTab == StoreTab.More && moreSection == MoreSection.Suppliers && "page.suppliers.manage" in user.permissions -> {
                    FloatingActionButton(onClick = { supplierEditTarget = null; supplierDialogOpen = true }) {
                        Icon(Icons.Filled.Add, contentDescription = "إضافة مورد")
                    }
                }
                activeTab == StoreTab.More && moreSection == MoreSection.Installments &&
                    "page.installments.manage" in user.permissions -> {
                    FloatingActionButton(onClick = {
                        if (debtsSection == "personal") {
                            personalDebtEditTarget = null
                            personalDebtDialogOpen = true
                        } else {
                            if ("page.products.view" in user.permissions) storeViewModel.refreshProducts(null)
                            installmentEditTarget = null
                            installmentDialogOpen = true
                        }
                    }) {
                        Icon(Icons.Filled.Add, contentDescription = if (debtsSection == "personal") "إضافة دين عليّ" else "إضافة دين عميل")
                    }
                }
                activeTab == StoreTab.More && moreSection == MoreSection.Wallets && "page.wallets.manage" in user.permissions -> {
                    FloatingActionButton(onClick = { walletDialogOpen = true }) {
                        Icon(Icons.Filled.Add, contentDescription = "إضافة محفظة")
                    }
                }
                activeTab == StoreTab.More && moreSection == MoreSection.Maintenance && "page.maintenance.manage" in user.permissions -> {
                    FloatingActionButton(onClick = {
                        maintenanceEditTarget = null
                        maintenanceDialogOpen = true
                    }) {
                        Icon(Icons.Filled.Add, contentDescription = "إضافة طلب صيانة")
                    }
                }
                activeTab == StoreTab.More && moreSection == MoreSection.Damaged && "page.damaged.manage" in user.permissions -> {
                    FloatingActionButton(onClick = {
                        storeViewModel.searchDamagedProducts(null)
                        damagedDialogOpen = true
                    }) {
                        Icon(Icons.Filled.Add, contentDescription = "تسجيل هالك")
                    }
                }
                activeTab == StoreTab.More && moreSection == MoreSection.WalletCashier && "page.wallet_cashier.manage" in user.permissions -> {
                    FloatingActionButton(onClick = { walletCashierDialogOpen = true }) {
                        Icon(Icons.Filled.Add, contentDescription = "تسجيل معاملة")
                    }
                }
                activeTab == StoreTab.Customers && "page.customers.manage" in user.permissions -> {
                    FloatingActionButton(onClick = { editor = EditTarget(EditKind.Customer) }) {
                        Icon(Icons.Filled.Add, contentDescription = "إضافة عميل")
                    }
                }
                activeTab == StoreTab.Invoices &&
                    "page.invoices.manage" in user.permissions &&
                    "page.products.view" in user.permissions -> {
                    FloatingActionButton(onClick = {
                        storeViewModel.refreshProducts(null)
                        invoiceDialogOpen = true
                    }) {
                        Icon(Icons.Filled.Add, contentDescription = "إنشاء فاتورة")
                    }
                }
            }
        },
        bottomBar = {
            NavigationBar {
                availableTabs.filterNot { it == StoreTab.Customers }.forEach { tab ->
                    NavigationBarItem(
                        selected = activeTab == tab,
                        onClick = {
                            selectedTab = tab.name
                            searchQuery = ""
                            if (tab == StoreTab.More) moreSectionName = MoreSection.Home.name
                        },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(tab.label, maxLines = 1) },
                    )
                }
            }
        },
    ) { scaffoldPadding ->
        PullToRefreshBox(
            isRefreshing = pullRefreshing,
            onRefresh = {
                pullRefreshing = true
                refreshCurrent(true)
                onCheckConnection()
                pullScope.launch {
                    delay(900)
                    pullRefreshing = false
                }
            },
            modifier = Modifier.padding(scaffoldPadding).fillMaxSize(),
        ) {
            val padding = PaddingValues(0.dp)
            when (activeTab) {
            StoreTab.Dashboard -> HomeDashboardScreen(
                userName = user.name,
                isLoading = products.isEmpty() && productPage.isLoading,
                metrics = dashboardMetrics,
                alerts = dashboardAlerts,
                quickActions = quickActions,
                modifier = Modifier.padding(padding),
            )
            StoreTab.Products -> ProductListScreen(
                products = products,
                categories = categories,
                cacheTime = cacheTime,
                error = productError,
                page = productPage,
                query = searchQuery,
                selectedCategoryId = selectedProductCategoryId,
                inStockFilter = productStockFilter,
                canManage = "page.products.manage" in user.permissions,
                onQueryChange = { searchQuery = it },
                onCategoryChange = { selectedProductCategoryId = it },
                onStockFilterChange = { productStockFilter = it },
                onRefresh = {
                    storeViewModel.refreshProducts(
                        searchQuery.ifBlank { null },
                        categoryId = selectedProductCategoryId,
                        inStock = productStockFilter,
                    )
                },
                onLoadMore = storeViewModel::loadMoreProducts,
                onProductClick = {
                    selectedProduct = it
                    storeViewModel.loadProductDetails(it.id)
                },
                onEdit = { productEditTarget = it; productDialogOpen = true },
                onDelete = { productDeleteTarget = it },
                modifier = Modifier.padding(padding),
            )
            StoreTab.Customers -> CustomerListScreen(
                state = customers,
                query = searchQuery,
                canManage = "page.customers.manage" in user.permissions,
                onQueryChange = { searchQuery = it },
                onRefresh = { storeViewModel.refreshCustomers(searchQuery.ifBlank { null }) },
                onLoadMore = storeViewModel::loadMoreCustomers,
                onEdit = { editor = EditTarget(EditKind.Customer, it.id, it.name, it.phone.orEmpty(), it.address.orEmpty()) },
                onDelete = { deleteTarget = DeleteTarget(EditKind.Customer, it.id, it.name) },
                onCustomerClick = {
                    selectedCustomer = it
                    storeViewModel.loadCustomerDetails(it.id)
                },
                modifier = Modifier.padding(padding),
            )
            StoreTab.Invoices -> InvoicesScreen(
                state = invoices,
                query = searchQuery,
                canManage = "page.invoices.manage" in user.permissions,
                canEdit = "page.invoices.manage" in user.permissions && "page.products.view" in user.permissions,
                onQueryChange = { searchQuery = it },
                onRefresh = { storeViewModel.refreshInvoices(searchQuery.ifBlank { null }) },
                onLoadMore = storeViewModel::loadMoreInvoices,
                onInvoiceClick = {
                    selectedInvoice = it
                    storeViewModel.loadInvoiceDetails(it.id)
                },
                onPay = { paymentInvoiceTarget = it },
                onChangeStatus = { invoiceStatusTarget = it },
                onEdit = {
                    storeViewModel.refreshProducts(null)
                    invoiceEditTarget = it
                },
                modifier = Modifier.padding(padding),
            )
            StoreTab.Installments -> InstallmentsHubScreen(
                section = debtsSection,
                onSectionChange = { debtsSection = it },
                installments = installments,
                personalDebts = personalDebts,
                query = searchQuery,
                onQueryChange = { searchQuery = it },
                onRefresh = {
                    storeViewModel.refreshInstallments(searchQuery.ifBlank { null })
                    storeViewModel.refreshPersonalDebts(searchQuery.ifBlank { null })
                },
                canManage = "page.installments.manage" in user.permissions,
                onInstallmentClick = {
                    selectedInstallment = it
                    storeViewModel.loadInstallmentDetails(it.id)
                },
                onInstallmentPay = { paymentInstallmentTarget = it },
                onInstallmentStatus = { installmentStatusTarget = it },
                onInstallmentEdit = { installmentEditTarget = it; installmentDialogOpen = true },
                onInstallmentDelete = { deleteTarget = DeleteTarget(EditKind.Installment, it.id, it.customer) },
                onLoadMoreInstallments = storeViewModel::loadMoreInstallments,
                onDebtClick = { selectedPersonalDebt = it },
                onDebtPay = { paymentPersonalDebtTarget = it },
                onDebtEdit = { personalDebtEditTarget = it; personalDebtDialogOpen = true },
                onDebtDelete = { personalDebtDeleteTarget = it },
                onLoadMoreDebts = storeViewModel::loadMorePersonalDebts,
                modifier = Modifier.padding(padding),
            )
            StoreTab.More -> when (moreSection) {
                MoreSection.Home -> MoreHubScreen(
                    canViewCategories = "page.categories.view" in user.permissions,
                    canViewCustomers = "page.customers.view" in user.permissions,
                    canViewSuppliers = "page.suppliers.view" in user.permissions,
                    canViewInstallments = "page.installments.view" in user.permissions,
                    canViewWallets = "page.wallets.view" in user.permissions,
                    canViewWalletCashier = "page.wallet_cashier.view" in user.permissions,
                    canViewProductCashier = "page.invoices.manage" in user.permissions,
                    canViewSales = "page.sales.view" in user.permissions,
                    canViewNotifications = "page.notifications.view" in user.permissions,
                    canViewMaintenance = "page.maintenance.view" in user.permissions,
                    canViewDamaged = "page.damaged.view" in user.permissions,
                    canViewBackup = "page.backup.manage" in user.permissions,
                    onOpenProfile = {
                        moreSectionName = MoreSection.Profile.name
                        searchQuery = ""
                    },
                    onOpenCategories = {
                        moreSectionName = MoreSection.Categories.name
                        searchQuery = ""
                    },
                    onOpenCustomers = {
                        moreSectionName = MoreSection.Customers.name
                        searchQuery = ""
                        storeViewModel.refreshCustomers(null)
                    },
                    onOpenSuppliers = {
                        moreSectionName = MoreSection.Suppliers.name
                        searchQuery = ""
                    },
                    onOpenInstallments = {
                        moreSectionName = MoreSection.Installments.name
                        searchQuery = ""
                    },
                    onOpenWallets = {
                        moreSectionName = MoreSection.Wallets.name
                        searchQuery = ""
                        storeViewModel.refreshWalletOverview()
                    },
                    onOpenWalletCashier = {
                        moreSectionName = MoreSection.WalletCashier.name
                        searchQuery = ""
                        storeViewModel.refreshWalletCashier()
                    },
                    onOpenProductCashier = {
                        moreSectionName = MoreSection.ProductCashier.name
                        searchQuery = ""
                        storeViewModel.searchCashierProducts("")
                    },
                    onOpenSales = {
                        moreSectionName = MoreSection.Sales.name
                        searchQuery = ""
                    },
                    onOpenNotifications = {
                        moreSectionName = MoreSection.Notifications.name
                        searchQuery = ""
                        storeViewModel.refreshNotifications()
                    },
                    onOpenMaintenance = {
                        moreSectionName = MoreSection.Maintenance.name
                        searchQuery = ""
                    },
                    onOpenDamaged = {
                        moreSectionName = MoreSection.Damaged.name
                        searchQuery = ""
                        storeViewModel.refreshDamagedItems(null)
                    },
                    onOpenBackup = { moreSectionName = MoreSection.Backup.name; searchQuery = "" },
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Categories -> CategoryListScreen(
                    categories = categories,
                    page = categoryPage,
                    error = categoryError,
                    query = searchQuery,
                    canManage = "page.categories.manage" in user.permissions,
                    onQueryChange = { searchQuery = it },
                    onRefresh = { storeViewModel.refreshCategories(null) },
                    onLoadMore = storeViewModel::loadMoreCategories,
                    onEdit = { editor = EditTarget(EditKind.Category, it.id, it.name) },
                    onDelete = { deleteTarget = DeleteTarget(EditKind.Category, it.id, it.name) },
                    onCategoryClick = {
                        selectedCategory = it
                        storeViewModel.loadCategoryDetails(it.id)
                    },
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Customers -> CustomerListScreen(
                    state = customers,
                    query = searchQuery,
                    canManage = "page.customers.manage" in user.permissions,
                    onQueryChange = { searchQuery = it },
                    onRefresh = { storeViewModel.refreshCustomers(searchQuery.ifBlank { null }) },
                    onLoadMore = storeViewModel::loadMoreCustomers,
                    onEdit = { editor = EditTarget(EditKind.Customer, it.id, it.name, it.phone.orEmpty(), it.address.orEmpty()) },
                    onDelete = { deleteTarget = DeleteTarget(EditKind.Customer, it.id, it.name) },
                    onCustomerClick = {
                        selectedCustomer = it
                        storeViewModel.loadCustomerDetails(it.id)
                    },
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Suppliers -> SupplierListScreen(
                    state = suppliers,
                    canManage = "page.suppliers.manage" in user.permissions,
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    onRefresh = { storeViewModel.refreshSuppliers(searchQuery.ifBlank { null }) },
                    onLoadMore = storeViewModel::loadMoreSuppliers,
                    onSupplierClick = {
                        selectedSupplier = it
                        storeViewModel.loadSupplierDetails(it.id)
                    },
                    onEdit = { supplierEditTarget = it },
                    onDelete = { supplierDeleteTarget = it },
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Profile -> ProfileScreen(
                    user = user,
                    state = profileState,
                    onEdit = { profileEditOpen = true },
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Backup -> BackupScreen(
                    pages = backupPages,
                    isBusy = storeViewModel.backupBusy.collectAsStateWithLifecycle().value,
                    canImport = "page.backup.manage" in user.permissions,
                    onToggle = { page -> backupPages = if (page in backupPages) backupPages - page else backupPages + page },
                    onExport = { backupExportPicker.launch("store-backup.zip") },
                    onImport = { backupImportPicker.launch(arrayOf("application/zip", "application/x-zip-compressed", "application/octet-stream")) },
                    snackbarHost = backupMessageHost,
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Installments -> InstallmentsHubScreen(
                    section = debtsSection,
                    onSectionChange = { debtsSection = it },
                    installments = installments,
                    personalDebts = personalDebts,
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    onRefresh = {
                        storeViewModel.refreshInstallments(searchQuery.ifBlank { null })
                        storeViewModel.refreshPersonalDebts(searchQuery.ifBlank { null })
                    },
                    canManage = "page.installments.manage" in user.permissions,
                    onInstallmentClick = {
                        selectedInstallment = it
                        storeViewModel.loadInstallmentDetails(it.id)
                    },
                    onInstallmentPay = { paymentInstallmentTarget = it },
                    onInstallmentStatus = { installmentStatusTarget = it },
                    onInstallmentEdit = { installmentEditTarget = it; installmentDialogOpen = true },
                    onInstallmentDelete = { deleteTarget = DeleteTarget(EditKind.Installment, it.id, it.customer) },
                    onLoadMoreInstallments = storeViewModel::loadMoreInstallments,
                    onDebtClick = { selectedPersonalDebt = it },
                    onDebtPay = { paymentPersonalDebtTarget = it },
                    onDebtEdit = { personalDebtEditTarget = it; personalDebtDialogOpen = true },
                    onDebtDelete = { personalDebtDeleteTarget = it },
                    onLoadMoreDebts = storeViewModel::loadMorePersonalDebts,
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Wallets -> WalletOverviewScreen(
                    state = walletState,
                    canManage = "page.wallets.manage" in user.permissions,
                    canUseCashier = "page.wallet_cashier.view" in user.permissions,
                    onRefresh = storeViewModel::refreshWalletOverview,
                    onOpenCashier = {
                        moreSectionName = MoreSection.WalletCashier.name
                        storeViewModel.refreshWalletCashier()
                    },
                    onAdjustWallet = { walletAdjustmentTarget = it },
                    onToggleWallet = { id -> storeViewModel.toggleWallet(id, UUID.randomUUID().toString()) },
                    modifier = Modifier.padding(padding),
                )
                MoreSection.WalletCashier -> WalletCashierScreen(
                    state = walletCashierState,
                    canManage = "page.wallet_cashier.manage" in user.permissions,
                    canReverse = "page.wallets.manage" in user.permissions,
                    onRefresh = storeViewModel::refreshWalletCashier,
                    onSettle = { cashierActionTarget = it; cashierAction = CashierAction.Settle },
                    onReverse = { cashierActionTarget = it; cashierAction = CashierAction.Reverse },
                    modifier = Modifier.padding(padding),
                )
                MoreSection.ProductCashier -> ProductCashierScreen(
                    state = cashierPosState,
                    isSaving = isSaving,
                    onSearch = storeViewModel::searchCashierProducts,
                    onCheckout = storeViewModel::checkoutCashier,
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Damaged -> DamagedScreen(
                    state = damagedItems,
                    statusFilter = damagedStatusFilter,
                    onStatusChange = {
                        damagedStatusFilter = it
                        storeViewModel.refreshDamagedItems(searchQuery.ifBlank { null }, it)
                    },
                    canManage = "page.damaged.manage" in user.permissions,
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    onRefresh = { storeViewModel.refreshDamagedItems(searchQuery.ifBlank { null }, damagedStatusFilter) },
                    onLoadMore = {
                        storeViewModel.refreshDamagedItems(
                            searchQuery.ifBlank { null },
                            damagedStatusFilter,
                            page = damagedItems.currentPage + 1,
                        )
                    },
                    onDetails = { selectedDamaged = it },
                    onEdit = { damagedEditTarget = it },
                    onDelete = { damagedVoidTarget = it },
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Sales -> SalesListScreen(
                    state = sales,
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    onRefresh = { storeViewModel.refreshSales(searchQuery.ifBlank { null }) },
                    onLoadMore = storeViewModel::loadMoreSales,
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Notifications -> NotificationListScreen(
                    state = notifications,
                    onRefresh = { storeViewModel.refreshNotifications() },
                    onLoadMore = storeViewModel::loadMoreNotifications,
                    onMarkRead = storeViewModel::markNotificationRead,
                    onMarkAllRead = storeViewModel::markAllNotificationsRead,
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Maintenance -> MaintenanceScreen(
                    state = maintenances,
                    query = searchQuery,
                    canManage = "page.maintenance.manage" in user.permissions,
                    onQueryChange = { searchQuery = it },
                    onRefresh = { storeViewModel.refreshMaintenances(searchQuery.ifBlank { null }) },
                    onLoadMore = storeViewModel::loadMoreMaintenances,
                    onChangeStatus = { maintenanceStatusTarget = it },
                    onEdit = { maintenanceEditTarget = it; maintenanceDialogOpen = true },
                    onDelete = { maintenanceDeleteTarget = it },
                    modifier = Modifier.padding(padding),
                )
            }
        }
        }
    }

    editor?.let { target ->
        StoreEditDialog(
            target = target,
            onDismiss = { editor = null },
            onSave = { kind, id, name, phone, address, key ->
                when (kind) {
                    EditKind.Category -> {
                        val input = CategoryInputDto(name)
                        if (id == null) storeViewModel.createCategory(input, key)
                        else storeViewModel.updateCategory(id, input)
                    }
                    EditKind.Customer -> {
                        val input = CustomerInputDto(name.trim(), phone.trim().ifBlank { null }, address.trim().ifBlank { null })
                        if (id == null) storeViewModel.createCustomer(input, key)
                        else storeViewModel.updateCustomer(id, input)
                    }
                    EditKind.Installment -> Unit
                }
            },
        )
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("تأكيد الحذف") },
            text = { DialogForm(maxHeight = 320.dp) { Text("هل تريد حذف ${target.name}؟") } },
            confirmButton = {
                Button(enabled = !LocalIsSaving.current, onClick = {
                    when (target.kind) {
                        EditKind.Category -> storeViewModel.deleteCategory(target.id)
                        EditKind.Customer -> storeViewModel.deleteCustomer(target.id)
                        EditKind.Installment -> storeViewModel.deleteInstallment(target.id, UUID.randomUUID().toString())
                    }
                }) { Text("حذف") }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("إلغاء") } },
        )
    }

    if (invoiceDialogOpen) {
        InvoiceCreateDialog(
            products = products,
            onDismiss = { invoiceDialogOpen = false },
            onCreate = storeViewModel::createInvoice,
            onBarcodeLookup = storeViewModel::findProductByBarcode,
        )
    }

    if (productDialogOpen) {
        ProductEditDialog(
            product = productEditTarget,
            categories = categories,
            onDismiss = { productDialogOpen = false },
            onSave = { id, input, key, imageUri ->
                storeViewModel.saveProduct(id, input, key, imageUri, context.contentResolver, context.cacheDir)
            },
        )
    }

    invoiceEditTarget?.let { invoice ->
        InvoiceCreateDialog(
            products = products,
            initial = invoice,
            onDismiss = { invoiceEditTarget = null },
            onCreate = { input, key -> storeViewModel.updateInvoice(invoice.id, input, key) },
            onBarcodeLookup = storeViewModel::findProductByBarcode,
        )
    }

    invoiceStatusTarget?.let { invoice ->
        StatusChoiceDialog(
            title = "تغيير حالة الفاتورة",
            summary = "فاتورة ${invoice.invoiceNumber} · الإجمالي ${invoice.totalAmount} · المتبقي ${invoice.remainingAmount} ج.م. لتحويلها إلى غير مدفوعة عدّل المبلغ المدفوع من زر التعديل.",
            options = invoiceStatusOptions(invoice),
            initial = null,
            confirmLabel = "تأكيد",
            onDismiss = { invoiceStatusTarget = null },
            onConfirm = { value, key ->
                if (value == "paid") {
                    storeViewModel.payInvoice(invoice.id, PayAmountInputDto(), key)
                } else {
                    invoiceStatusTarget = null
                    invoiceRefundTarget = invoice
                }
            },
        )
    }

    invoiceRefundTarget?.let { invoice ->
        val refundKey = remember(invoice.id) { UUID.randomUUID().toString() }
        ConfirmDialog(
            title = "استرداد الفاتورة",
            message = "سيتم استرداد الفاتورة ${invoice.invoiceNumber} وإرجاع منتجاتها إلى المخزون وإغلاق أي قسط مرتبط بها. لا يمكن التراجع عن هذا الإجراء.",
            confirmLabel = "استرداد",
            onDismiss = { invoiceRefundTarget = null },
            onConfirm = { storeViewModel.refundInvoice(invoice.id, refundKey) },
        )
    }

    installmentStatusTarget?.let { installment ->
        StatusChoiceDialog(
            title = "تغيير حالة القسط",
            summary = "${installment.customer} · المتبقي ${installment.remaining} ج.م",
            options = installmentStatusOptions(installment),
            initial = installment.statusValueForDialog(),
            confirmLabel = "تغيير الحالة",
            onDismiss = { installmentStatusTarget = null },
            onConfirm = { status, key -> storeViewModel.changeInstallmentStatus(installment.id, status, key) },
        )
    }

    maintenanceStatusTarget?.let { record ->
        StatusChoiceDialog(
            title = "تغيير حالة الجهاز",
            summary = "${record.name} · ${record.owner}",
            options = MaintenanceStatusOptions.map { ChoiceOption(it, it) },
            initial = record.status,
            confirmLabel = "حفظ الحالة",
            onDismiss = { maintenanceStatusTarget = null },
            onConfirm = { status, _ ->
                storeViewModel.updateMaintenance(
                    record.id,
                    MaintenanceInputDto(
                        name = record.name,
                        owner = record.owner,
                        phone = record.phone,
                        address = record.address,
                        description = record.description,
                        status = status,
                        requestedDate = record.requestedDate,
                    ),
                )
            },
        )
    }

    damagedEditTarget?.let { item ->
        DamagedItemEditDialog(
            item = item,
            onDismiss = { damagedEditTarget = null },
            onSave = { input, key -> storeViewModel.updateDamagedItem(item.id, input, key) },
        )
    }

    if (personalDebtDialogOpen) {
        PersonalDebtEditDialog(
            debt = personalDebtEditTarget,
            onDismiss = { personalDebtDialogOpen = false },
            onSave = { id, input, key ->
                if (id == null) storeViewModel.createPersonalDebt(input, key)
                else storeViewModel.updatePersonalDebt(id, input, key)
            },
        )
    }

    paymentPersonalDebtTarget?.let { debt ->
        PaymentAmountDialog(
            title = "سداد دين ${debt.creditor}",
            remaining = debt.remaining,
            requireAmount = true,
            onDismiss = { paymentPersonalDebtTarget = null },
            onPay = { input, key -> storeViewModel.payPersonalDebt(debt.id, input, key) },
        )
    }

    personalDebtDeleteTarget?.let { debt ->
        val deleteKey = remember(debt.id) { UUID.randomUUID().toString() }
        ConfirmDialog(
            title = "حذف الدين",
            message = "هل تريد حذف الدين المستحق لـ ${debt.creditor}؟ لا يمكن حذف دين له سجل دفعات.",
            confirmLabel = "حذف",
            onDismiss = { personalDebtDeleteTarget = null },
            onConfirm = { storeViewModel.deletePersonalDebt(debt.id, deleteKey) },
        )
    }

    selectedPersonalDebt?.let { debt ->
        ModalBottomSheet(onDismissRequest = { selectedPersonalDebt = null }) {
            PersonalDebtDetailsSheet(debt)
        }
    }

    selectedDamaged?.let { item ->
        ModalBottomSheet(onDismissRequest = { selectedDamaged = null }) {
            DamagedDetailsSheet(item)
        }
    }

    if (profileEditOpen) {
        ProfileEditDialog(
            profile = profileState.profile,
            onDismiss = { profileEditOpen = false },
            onSave = storeViewModel::updateProfile,
        )
    }

    if (damagedDialogOpen) {
        DamagedItemCreateDialog(
            products = damagedProductsState.products,
            isLoading = damagedProductsState.isLoading,
            error = damagedProductsState.error,
            onSearch = storeViewModel::searchDamagedProducts,
            onDismiss = { damagedDialogOpen = false },
            onCreate = storeViewModel::createDamagedItem,
        )
    }

    damagedVoidTarget?.let { item ->
        VoidDamagedItemDialog(
            item = item,
            onDismiss = { damagedVoidTarget = null },
            onVoid = { input, key -> storeViewModel.voidDamagedItem(item.id, input, key) },
        )
    }

    productDeleteTarget?.let { product ->
        AlertDialog(
            onDismissRequest = { productDeleteTarget = null },
            title = { Text("حذف المنتج") },
            text = { DialogForm(maxHeight = 320.dp) { Text("هل تريد حذف ${product.name}؟ لا يمكن حذف منتج له سجل مبيعات أو فواتير أو أقساط.") } },
            confirmButton = {
                Button(enabled = !LocalIsSaving.current, onClick = { storeViewModel.deleteProduct(product.id, UUID.randomUUID().toString()) }) { Text("حذف") }
            },
            dismissButton = { TextButton(onClick = { productDeleteTarget = null }) { Text("إلغاء") } },
        )
    }

    if (walletDialogOpen) {
        WalletCreateDialog(
            onDismiss = { walletDialogOpen = false },
            onCreate = storeViewModel::createWallet,
        )
    }

    walletAdjustmentTarget?.let { wallet ->
        WalletAdjustmentDialog(
            wallet = wallet,
            onDismiss = { walletAdjustmentTarget = null },
            onAdjust = { input, key ->
                storeViewModel.adjustWallet(wallet.id, input, key)
            },
        )
    }

    if (supplierDialogOpen) {
        SupplierCreateDialog(
            onDismiss = { supplierDialogOpen = false },
            onSave = { _, input, key -> storeViewModel.createSupplier(input, key); supplierDialogOpen = false },
        )
    }

    supplierEditTarget?.let { supplier ->
        SupplierCreateDialog(
            supplier = supplier,
            onDismiss = { supplierEditTarget = null },
            onSave = { id, input, key ->
                if (id != null) storeViewModel.updateSupplier(id, input, key)
                supplierEditTarget = null
            },
        )
    }

    supplierDeleteTarget?.let { supplier ->
        AlertDialog(
            onDismissRequest = { supplierDeleteTarget = null },
            title = { Text("حذف المورد") },
            text = { DialogForm(maxHeight = 300.dp) { Text("سيؤدي حذف ${supplier.name} إلى حذف سجل مشترياته ومدفوعاته. هل تريد المتابعة؟") } },
            confirmButton = {
                Button(enabled = !LocalIsSaving.current, onClick = {
                    storeViewModel.deleteSupplier(supplier.id, UUID.randomUUID().toString())
                    supplierDeleteTarget = null
                }) { Text("حذف المورد") }
            },
            dismissButton = { TextButton(onClick = { supplierDeleteTarget = null }) { Text("إلغاء") } },
        )
    }

    if (installmentDialogOpen) {
        InstallmentCreateDialog(
            products = products,
            canSelectProducts = "page.products.view" in user.permissions,
            record = installmentEditTarget,
            onDismiss = { installmentDialogOpen = false },
            onSave = { id, input, key ->
                if (id == null) storeViewModel.createInstallment(input, key)
                else storeViewModel.updateInstallment(id, input, key)
            },
        )
    }

    paymentInstallmentTarget?.let { installment ->
        PaymentAmountDialog(
            title = "سداد القسط",
            remaining = installment.remaining,
            onDismiss = { paymentInstallmentTarget = null },
            onPay = { input, key -> storeViewModel.payInstallment(installment.id, input, key) },
        )
    }

    paymentInvoiceTarget?.let { invoice ->
        PaymentAmountDialog(
            title = "سداد الفاتورة ${invoice.invoiceNumber}",
            remaining = invoice.remainingAmount,
            onDismiss = { paymentInvoiceTarget = null },
            onPay = { input, key -> storeViewModel.payInvoice(invoice.id, input, key) },
        )
    }

    if (maintenanceDialogOpen) {
        MaintenanceEditDialog(
            record = maintenanceEditTarget,
            onDismiss = { maintenanceDialogOpen = false },
            onSave = { input, key ->
                val record = maintenanceEditTarget
                if (record == null) storeViewModel.createMaintenance(input, key)
                else storeViewModel.updateMaintenance(record.id, input)
            },
        )
    }

    maintenanceDeleteTarget?.let { record ->
        AlertDialog(
            onDismissRequest = { maintenanceDeleteTarget = null },
            title = { Text("حذف طلب الصيانة") },
            text = { DialogForm(maxHeight = 320.dp) { Text("هل تريد حذف طلب ${record.name}؟") } },
            confirmButton = {
                Button(enabled = !LocalIsSaving.current, onClick = { storeViewModel.deleteMaintenance(record.id) }) { Text("حذف") }
            },
            dismissButton = { TextButton(onClick = { maintenanceDeleteTarget = null }) { Text("إلغاء") } },
        )
    }

    if (walletCashierDialogOpen) {
        WalletCashierCreateDialog(
            wallets = walletCashierState.data?.wallets.orEmpty(),
            onDismiss = { walletCashierDialogOpen = false },
            onCreate = storeViewModel::createWalletTransaction,
        )
    }

    val actionTransaction = cashierActionTarget
    val actionType = cashierAction
    if (actionTransaction != null && actionType != null) {
        WalletCashierActionDialog(
            transaction = actionTransaction,
            action = actionType,
            onDismiss = { cashierActionTarget = null; cashierAction = null },
            onSettle = { input, key -> storeViewModel.settleWalletTransaction(actionTransaction.uuid, input, key) },
            onReverse = { input, key -> storeViewModel.reverseWalletTransaction(actionTransaction.uuid, input, key) },
        )
    }

    selectedProduct?.let { cached ->
        ModalBottomSheet(
            onDismissRequest = {
                selectedProduct = null
                storeViewModel.clearProductDetails()
            },
        ) {
            ProductDetailsSheet(cached, productDetails)
        }
    }

    selectedInvoice?.let { cached ->
        ModalBottomSheet(
            onDismissRequest = {
                selectedInvoice = null
                storeViewModel.clearInvoiceDetails()
            },
        ) {
            InvoiceDetailsSheet(cached, invoiceDetails, invoicePdfState) { invoiceId ->
                invoicePdfPendingId = invoiceId
                invoicePdfPicker.launch("invoice-${cached.invoiceNumber}.pdf")
            }
        }
    }

    selectedSupplier?.let { cached ->
        ModalBottomSheet(
            onDismissRequest = {
                selectedSupplier = null
                storeViewModel.clearSupplierDetails()
            },
        ) {
            SupplierDetailsSheet(cached, supplierDetails)
        }
    }

    selectedInstallment?.let { cached ->
        ModalBottomSheet(
            onDismissRequest = {
                selectedInstallment = null
                storeViewModel.clearInstallmentDetails()
            },
        ) {
            InstallmentDetailsSheet(cached, installmentDetails)
        }
    }

    selectedCategory?.let { cached ->
        ModalBottomSheet(
            onDismissRequest = {
                selectedCategory = null
                storeViewModel.clearCategoryDetails()
            },
        ) {
            CategoryDetailsSheet(cached, categoryDetails)
        }
    }

    selectedCustomer?.let { cached ->
        ModalBottomSheet(
            onDismissRequest = {
                selectedCustomer = null
                storeViewModel.clearCustomerDetails()
            },
        ) {
            CustomerDetailsSheet(cached, customerDetails)
        }
    }
}

@Composable
private fun ProductListScreen(
    products: List<CachedProduct>,
    categories: List<CachedCategory>,
    cacheTime: Long?,
    error: String?,
    page: RemotePage<ProductDto>,
    query: String,
    selectedCategoryId: Long?,
    inStockFilter: Boolean?,
    canManage: Boolean,
    onQueryChange: (String) -> Unit,
    onCategoryChange: (Long?) -> Unit,
    onStockFilterChange: (Boolean?) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onProductClick: (CachedProduct) -> Unit,
    onEdit: (CachedProduct) -> Unit,
    onDelete: (CachedProduct) -> Unit,
    modifier: Modifier = Modifier,
) {
    val visible = remember(products, page.items, query, selectedCategoryId, inStockFilter) {
        val source = if (query.isBlank() && selectedCategoryId == null && inStockFilter == null) {
            products
        } else {
            page.items.map(ProductDto::toCachedProduct)
        }
        source.filter { product ->
            (query.isBlank() || product.name.contains(query, ignoreCase = true) || product.barcode.orEmpty().contains(query, ignoreCase = true)) &&
                (selectedCategoryId == null || product.categoryId == selectedCategoryId) &&
                (inStockFilter == null || (product.stock > 0) == inStockFilter)
        }
    }
    Column(modifier.fillMaxSize().imePadding()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        ProductFilters(
            categories = categories,
            selectedCategoryId = selectedCategoryId,
            inStockFilter = inStockFilter,
            onCategoryChange = onCategoryChange,
            onStockFilterChange = onStockFilterChange,
        )
        CacheStatus(cacheTime, error)
        if (visible.isEmpty() && page.isLoading) LoadingRow()
        else if (visible.isEmpty()) {
            EmptyState(if (error != null) "تعذر تحميل المنتجات" else "لا توجد منتجات مطابقة")
        } else {
            LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(visible, key = CachedProduct::id) {
                    ProductRow(product = it, canManage = canManage, onClick = { onProductClick(it) }, onEdit = { onEdit(it) }, onDelete = { onDelete(it) })
                }
                item { LoadMoreButton(page, onLoadMore) }
            }
        }
    }
}

@Composable
private fun ProductFilters(
    categories: List<CachedCategory>,
    selectedCategoryId: Long?,
    inStockFilter: Boolean?,
    onCategoryChange: (Long?) -> Unit,
    onStockFilterChange: (Boolean?) -> Unit,
) {
    var categoryMenuOpen by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box {
            androidx.compose.material3.OutlinedButton(onClick = { categoryMenuOpen = true }) {
                Text(categories.firstOrNull { it.id == selectedCategoryId }?.name ?: "كل التصنيفات", maxLines = 1)
            }
            DropdownMenu(expanded = categoryMenuOpen, onDismissRequest = { categoryMenuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("كل التصنيفات") },
                    onClick = { onCategoryChange(null); categoryMenuOpen = false },
                )
                categories.forEach { category ->
                    DropdownMenuItem(
                        text = { Text(category.name) },
                        onClick = { onCategoryChange(category.id); categoryMenuOpen = false },
                    )
                }
            }
        }
        FilterChip(selected = inStockFilter == null, onClick = { onStockFilterChange(null) }, label = { Text("الكل") })
        FilterChip(selected = inStockFilter == true, onClick = { onStockFilterChange(true) }, label = { Text("متوفر") })
        FilterChip(selected = inStockFilter == false, onClick = { onStockFilterChange(false) }, label = { Text("نفد") })
    }
}

@Composable
private fun ProductRow(
    product: CachedProduct,
    canManage: Boolean,
    onClick: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AsyncImage(
                model = product.imageUrl,
                contentDescription = product.name,
                placeholder = painterResource(android.R.drawable.ic_menu_gallery),
                error = painterResource(android.R.drawable.ic_menu_gallery),
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(64.dp).clip(RoundedCornerShape(8.dp)),
            )
            Column(Modifier.weight(1f).align(Alignment.CenterVertically), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(product.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    listOfNotNull(product.categoryName, product.barcode?.takeIf(String::isNotBlank)).joinToString("  ·  ").ifBlank { "بدون تصنيف" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("السعر  ${product.price}", style = MaterialTheme.typography.bodyMedium)
                    Text(
                        "المخزون  ${product.stock}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (product.stock <= 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
        if (canManage) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CardActionButton("تعديل", Icons.Filled.Edit, onEdit, Modifier.weight(1f), ActionStyle.Tonal)
                CardActionButton("حذف", Icons.Filled.Delete, onDelete, Modifier.weight(1f), ActionStyle.Danger)
            }
        }
        }
    }
}

private fun ProductDto.toCachedProduct() = CachedProduct(
    id = id,
    name = name,
    price = price,
    description = description.orEmpty(),
    notes = notes,
    barcode = barcode,
    stock = stock,
    categoryId = category?.id,
    categoryName = category?.name,
    imageUrl = imageUrl,
    serverUpdatedAt = updatedAt,
    cachedAtEpochMillis = System.currentTimeMillis(),
)

@Composable
private fun ProductDetailsSheet(cached: CachedProduct, state: ProductDetailUiState) {
    val product = state.product
    Column(
        Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AsyncImage(
            model = product?.imageUrl ?: cached.imageUrl,
            contentDescription = product?.name ?: cached.name,
            placeholder = painterResource(android.R.drawable.ic_menu_gallery),
            error = painterResource(android.R.drawable.ic_menu_gallery),
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(8.dp)),
        )
        Text(product?.name ?: cached.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        when {
            state.isLoading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("جار تحديث التفاصيل من الخادم", style = MaterialTheme.typography.bodySmall)
            }
            state.error != null -> Text("${state.error} ستظهر البيانات المحفوظة إن توفرت.", color = MaterialTheme.colorScheme.error)
            product != null -> Text("تفاصيل محدثة من الخادم", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
        DetailLine("التصنيف", product?.category?.name ?: cached.categoryName ?: "بدون تصنيف")
        DetailLine("الرمز", product?.barcode ?: cached.barcode ?: "غير متوفر")
        DetailLine("السعر", product?.price ?: cached.price)
        DetailLine("المخزون", (product?.stock ?: cached.stock).toString())
        val description = product?.description ?: cached.description
        if (description.isNotBlank()) {
            Text("الوصف", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (product == null) {
            Text("السعر والمخزون المحفوظان للعرض فقط وقد لا يعكسان الحالة الحالية.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun InvoiceDetailsSheet(cached: InvoiceDto, state: InvoiceDetailUiState, pdfState: InvoicePdfUiState, onDownloadPdf: (Long) -> Unit) {
    val invoice = state.invoice ?: cached
    Column(
        Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("فاتورة ${invoice.invoiceNumber}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        when {
            state.isLoading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("جار تحديث تفاصيل الفاتورة", style = MaterialTheme.typography.bodySmall)
            }
            state.error != null -> Text("${state.error} يتم عرض النسخة المتاحة في القائمة.", color = MaterialTheme.colorScheme.error)
            state.invoice != null -> Text("تفاصيل الفاتورة من الخادم", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
        DetailLine("العميل", invoice.customer)
        DetailLine("التاريخ", invoice.invoiceDate.toArabicDateDisplay())
        DetailLine("الحالة", invoice.status.toArabicInvoiceStatus())
        DetailLine("عدد القطع", invoice.quantity.toString())
        DetailLine("الإجمالي", invoice.totalAmount)
        DetailLine("المدفوع", invoice.paidAmount)
        DetailLine("المتبقي", invoice.remainingAmount)
        if (invoice.items.isNotEmpty()) {
            Text("الأصناف", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            invoice.items.forEachIndexed { index, item ->
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(item.name ?: "صنف ${index + 1}", fontWeight = FontWeight.Medium)
                    Text(
                        listOfNotNull(
                            item.quantity?.let { "الكمية $it" },
                            item.price?.let { "السعر $it" },
                            item.lineTotal?.let { "الإجمالي $it" },
                        ).joinToString("  ·  "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        invoice.notes?.takeIf(String::isNotBlank)?.let {
            Text("ملاحظات", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (pdfState.isDownloading) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text(pdfState.message ?: "جارٍ تنزيل الفاتورة PDF…", style = MaterialTheme.typography.bodySmall)
            }
        } else if (pdfState.message != null) {
            Text(pdfState.message, color = if (pdfState.isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall)
        }
        OutlinedButton(onClick = { onDownloadPdf(invoice.id) }, enabled = !pdfState.isDownloading, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.AutoMirrored.Filled.ReceiptLong, contentDescription = null)
            Text("تنزيل الفاتورة PDF", modifier = Modifier.padding(start = 8.dp))
        }
    }
}

@Composable
private fun SupplierDetailsSheet(cached: SupplierDto, state: SupplierDetailUiState) {
    val supplier = state.supplier ?: cached
    Column(
        Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(supplier.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        when {
            state.isLoading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("جار تحديث بيانات المورد", style = MaterialTheme.typography.bodySmall)
            }
            state.error != null -> Text("${state.error} يتم عرض بيانات القائمة.", color = MaterialTheme.colorScheme.error)
            state.supplier != null -> Text("بيانات المورد من الخادم", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
        supplier.phone?.takeIf(String::isNotBlank)?.let { DetailLine("الهاتف", it) }
        supplier.email?.takeIf(String::isNotBlank)?.let { DetailLine("البريد الإلكتروني", it) }
        supplier.address?.takeIf(String::isNotBlank)?.let { DetailLine("العنوان", it) }
        DetailLine("الرصيد الافتتاحي", supplier.openingBalance)
        DetailLine("الرصيد المستحق", supplier.balance)
        DetailLine("فواتير الشراء", (supplier.purchasesCount ?: 0).toString())
        Text(
            "عرض فقط. تسجيل المشتريات والمدفوعات غير متاح عبر واجهة الهاتف الحالية.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun InstallmentDetailsSheet(cached: InstallmentDto, state: InstallmentDetailUiState) {
    val installment = state.installment ?: cached
    Column(
        Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("قسط #${installment.id}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        when {
            state.isLoading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("جار تحديث بيانات القسط", style = MaterialTheme.typography.bodySmall)
            }
            state.error != null -> Text("${state.error} يتم عرض بيانات القائمة.", color = MaterialTheme.colorScheme.error)
            state.installment != null -> Text("بيانات القسط من الخادم", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
        DetailLine("العميل", installment.customer)
        DetailLine("المنتج", installment.productName)
        DetailLine("الكمية", installment.quantity.toString())
        DetailLine("الإجمالي", installment.productPrice)
        DetailLine("المدفوع", installment.paidAmount)
        DetailLine("المتبقي", installment.remaining)
        DetailLine("الحالة", installment.status.toArabicInstallmentStatus())
        DetailLine("آخر سداد", installment.paymentDate?.toArabicDateDisplay() ?: "غير محدد")
        DetailLine("موعد السداد التالي", installment.nextPaymentDate?.toArabicDateDisplay() ?: "غير محدد")
        Text(
            "عرض فقط. تسجيل الدفعات غير متاح عبر واجهة الهاتف الحالية.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun CategoryDetailsSheet(cached: CachedCategory, state: CategoryDetailUiState) {
    val category = state.category
    Column(
        Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(category?.name ?: cached.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        when {
            state.isLoading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("جار تحديث بيانات التصنيف", style = MaterialTheme.typography.bodySmall)
            }
            state.error != null -> Text("${state.error} يتم عرض البيانات المحفوظة.", color = MaterialTheme.colorScheme.error)
            category != null -> Text("بيانات التصنيف من الخادم", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
        DetailLine("عدد المنتجات", (category?.productsCount ?: cached.productsCount ?: 0).toString())
    }
}

@Composable
private fun CustomerDetailsSheet(cached: CustomerDto, state: CustomerDetailUiState) {
    val customer = state.customer ?: cached
    Column(
        Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(customer.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        when {
            state.isLoading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text("جار تحديث بيانات العميل", style = MaterialTheme.typography.bodySmall)
            }
            state.error != null -> Text("${state.error} يتم عرض بيانات القائمة.", color = MaterialTheme.colorScheme.error)
            state.customer != null -> Text("بيانات العميل من الخادم", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
        }
        DetailLine("الهاتف", customer.phone.orEmpty().ifBlank { "غير متوفر" })
        DetailLine("العنوان", customer.address.orEmpty().ifBlank { "غير متوفر" })
    }
}

@Composable
internal fun DetailLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ProfileScreen(
    user: UserDto,
    state: ProfileUiState,
    onEdit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val permissionLabels = remember(user.permissions) {
        user.permissions.mapNotNull(String::toArabicPermissionLabel).distinct().sorted()
    }
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("حسابي", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        state.error?.let { ErrorBanner(it) }
        if (state.isLoading && state.profile == null) LoadingRow()
        DetailLine("الاسم", state.profile?.name ?: user.name)
        DetailLine("اسم المستخدم", user.username?.ifBlank { null } ?: "غير محدد")
        DetailLine("البريد الإلكتروني", state.profile?.email?.ifBlank { null } ?: "غير محدد")
        DetailLine("عدد الأدوار", user.roles.size.toString())
        CardActionButton("تعديل الحساب وكلمة المرور", Icons.Filled.Edit, onEdit, Modifier.fillMaxWidth(), ActionStyle.Filled)
        Text("الصلاحيات", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (permissionLabels.isEmpty()) {
            Text("لا توجد صلاحيات إضافية", color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            permissionLabels.forEach { label -> Text("• $label", color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}

@Composable
private fun MoreHubScreen(
    canViewCategories: Boolean,
    canViewCustomers: Boolean,
    canViewSuppliers: Boolean,
    canViewInstallments: Boolean,
    canViewWallets: Boolean,
    canViewWalletCashier: Boolean,
    canViewProductCashier: Boolean,
    canViewSales: Boolean,
    canViewNotifications: Boolean,
    canViewMaintenance: Boolean,
    canViewDamaged: Boolean,
    canViewBackup: Boolean,
    onOpenProfile: () -> Unit,
    onOpenCategories: () -> Unit,
    onOpenCustomers: () -> Unit,
    onOpenSuppliers: () -> Unit,
    onOpenInstallments: () -> Unit,
    onOpenWallets: () -> Unit,
    onOpenWalletCashier: () -> Unit,
    onOpenProductCashier: () -> Unit,
    onOpenSales: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenMaintenance: () -> Unit,
    onOpenDamaged: () -> Unit,
    onOpenBackup: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("المزيد", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("الوصول إلى وحدات حسابك", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("إدارة المتجر", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
            if (canViewCategories) MoreActionRow("التصنيفات", "تصنيفات المنتجات", Icons.Filled.Category, onOpenCategories)
            if (canViewCustomers) MoreActionRow("العملاء", "قائمة العملاء والبحث وإدارة بياناتهم", Icons.Filled.People, onOpenCustomers)
            if (canViewSales) MoreActionRow("المبيعات", "المنتجات المباعة حسب إجمالي الفواتير", Icons.Filled.BarChart, onOpenSales)
            if (canViewSuppliers) MoreActionRow("الموردون", "الأرصدة والحسابات الدائنة", Icons.Filled.People, onOpenSuppliers)
            if (canViewInstallments) MoreActionRow("الأقساط والديون", "الأرصدة ومواعيد السداد", Icons.AutoMirrored.Filled.ReceiptLong, onOpenInstallments)
            if (canViewWallets) MoreActionRow("المحافظ", "الأرصدة والنقدية والحدود", Icons.Filled.AccountBalanceWallet, onOpenWallets)
            if (canViewWalletCashier) MoreActionRow("كاشير المحافظ", "تسجيل التحويلات والتحصيلات", Icons.Filled.AccountBalanceWallet, onOpenWalletCashier)
            if (canViewProductCashier) MoreActionRow("نقطة البيع", "بحث المنتجات والسلة والتحصيل", Icons.Filled.Store, onOpenProductCashier)
            if (canViewDamaged) MoreActionRow("الهالك", "تسجيل التالف وعكس القيود بالسبب", Icons.Filled.Delete, onOpenDamaged)
            if (canViewMaintenance) MoreActionRow("الصيانة", "طلبات الصيانة وحالتها", Icons.Filled.Build, onOpenMaintenance)
        }
        if (canViewNotifications) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("التنبيهات", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                MoreActionRow("الإشعارات", "التنبيهات النشطة وحالة القراءة", Icons.Filled.Notifications, onOpenNotifications)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("الحساب", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
            MoreActionRow("حسابي", "الملف الشخصي والصلاحيات", Icons.Filled.AccountCircle, onOpenProfile)
            if (canViewBackup) MoreActionRow("النسخ الاحتياطي", "تصدير أو استيراد نسخة من بيانات المتجر", Icons.Filled.Inventory2, onOpenBackup)
        }
    }
}

@Composable
private fun BackupScreen(
    pages: Set<String>,
    isBusy: Boolean,
    canImport: Boolean,
    onToggle: (String) -> Unit,
    onExport: () -> Unit,
    onImport: () -> Unit,
    snackbarHost: SnackbarHostState,
    modifier: Modifier = Modifier,
) {
    val options = listOf(
        "catalog" to "المنتجات والتصنيفات", "customers" to "العملاء", "sales" to "المبيعات",
        "invoices" to "الفواتير", "installments" to "الأقساط والديون", "suppliers" to "الموردون",
        "maintenance" to "الصيانة", "wallets" to "المحافظ", "damaged" to "الهالك",
        "notifications" to "الإشعارات", "team" to "المستخدمون والصلاحيات",
    )
    Column(modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("اختر الصفحات التي تريد تضمينها. يمكن تحديد أكثر من صفحة.", style = MaterialTheme.typography.bodyMedium)
        if (isBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
        options.forEach { (key, label) ->
            Card(onClick = { onToggle(key) }, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = key in pages, onCheckedChange = { onToggle(key) })
                    Text(label, modifier = Modifier.padding(start = 8.dp))
                }
            }
        }
        Button(onClick = onExport, enabled = pages.isNotEmpty() && !isBusy, modifier = Modifier.fillMaxWidth()) { Text("تنزيل النسخة إلى الجهاز") }
        if (canImport) OutlinedButton(onClick = onImport, enabled = pages.isNotEmpty() && !isBusy, modifier = Modifier.fillMaxWidth()) { Text("استيراد من ملفات الجهاز") }
        Text("الاستيراد يدمج السجلات بحسب المعرّف، ولا يحذف السجلات الموجودة.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        SnackbarHost(snackbarHost)
    }
}

@Composable
private fun MoreActionRow(label: String, description: String, icon: ImageVector, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Surface(
                modifier = Modifier.size(40.dp),
                shape = RoundedCornerShape(8.dp),
                color = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun NotificationListScreen(
    state: RemotePage<NotificationDto>,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onMarkRead: (Long) -> Unit,
    onMarkAllRead: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val unreadCount = state.items.count { !it.isRead }
    Column(modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("$unreadCount غير مقروء", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (unreadCount > 0) TextButton(onClick = onMarkAllRead) { Text("تحديد الكل كمقروء") }
                IconButton(onClick = onRefresh, enabled = !state.isLoading) {
                    Icon(Icons.Filled.Refresh, contentDescription = "تحديث الإشعارات")
                }
            }
        }
        when {
            state.items.isEmpty() && state.isLoading -> LoadingRow()
            state.items.isEmpty() -> EmptyState(state.error ?: "لا توجد إشعارات جديدة")
            else -> {
                state.error?.let { ErrorBanner(it) }
                LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(state.items, key = NotificationDto::id) { notification ->
                        Card(
                            onClick = { if (!notification.isRead) onMarkRead(notification.id) },
                            shape = RoundedCornerShape(8.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = if (notification.isRead) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.secondaryContainer,
                            ),
                        ) {
                            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Row(horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Text(notification.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                    if (!notification.isRead) Text("جديد", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                                }
                                Text(notification.message, style = MaterialTheme.typography.bodyMedium)
                                notification.createdAt?.let { timestamp ->
                                    Text(timestamp.substringBefore('T'), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                    item { LoadMoreButton(state, onLoadMore) }
                }
            }
        }
    }
}

@Composable
private fun WalletCashierScreen(
    state: WalletCashierUiState,
    canManage: Boolean,
    canReverse: Boolean,
    onRefresh: () -> Unit,
    onSettle: (WalletCashierTransactionDto) -> Unit,
    onReverse: (WalletCashierTransactionDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("المبالغ الآجلة", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${state.data?.outstanding ?: "0.00"} ج.م", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            IconButton(onClick = onRefresh, enabled = !state.isLoading) {
                Icon(Icons.Filled.Refresh, contentDescription = "تحديث الكاشير")
            }
        }
        state.error?.let { ErrorBanner(it) }
        when {
            state.isLoading && state.data == null -> LoadingRow()
            state.data == null -> EmptyState("تعذر تحميل كاشير المحافظ")
            else -> LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item {
                    Text("المحافظ النشطة", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                }
                if (state.data.wallets.isEmpty()) {
                    item { EmptyState("أضف محفظة نشطة من صفحة المحافظ أولاً") }
                } else {
                    items(state.data.wallets, key = { it.id }) { wallet ->
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = MaterialTheme.colorScheme.surface,
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        ) {
                            Row(
                                Modifier.fillMaxWidth().padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(wallet.name, fontWeight = FontWeight.SemiBold)
                                    Text(wallet.provider, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Text("${wallet.balance} ج.م", fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
                item { Text("آخر المعاملات", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
                if (state.data.transactions.isEmpty()) {
                    item { EmptyState("لا توجد معاملات مسجلة") }
                } else {
                    items(state.data.transactions, key = WalletCashierTransactionDto::uuid) { transaction ->
                        Card(
                            shape = RoundedCornerShape(8.dp),
                            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        ) {
                            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(if (transaction.type == "send") "تحويل صادر" else "استلام", fontWeight = FontWeight.SemiBold)
                                    Text("${transaction.amount} ج.م", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                                }
                                Text("${transaction.walletName.orEmpty()} · ${transaction.counterparty.orEmpty()}", style = MaterialTheme.typography.bodySmall)
                                Text(
                                    if (transaction.paymentMethod == "deferred") "آجل · المتبقي ${transaction.receivable} ج.م" else "نقدي",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text("${transaction.status} · ${transaction.occurredAt.orEmpty()}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                if ((canManage && transaction.canSettle) || (canReverse && transaction.canReverse)) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        if (canManage && transaction.canSettle) TextButton(onClick = { onSettle(transaction) }) { Text("تحصيل") }
                                        if (canReverse && transaction.canReverse) TextButton(onClick = { onReverse(transaction) }) { Text("عكس") }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private data class PosCartLine(val product: CashierProductDto, val quantity: Int)

@Composable
private fun ProductCashierScreen(
    state: CashierPosUiState,
    isSaving: Boolean,
    onSearch: (String) -> Unit,
    onCheckout: (CashierCheckoutInputDto, String, (CashierCheckoutResponseDto) -> Unit) -> Unit,
    modifier: Modifier = Modifier,
) {
    var searchText by rememberSaveable { mutableStateOf("") }
    var customer by rememberSaveable { mutableStateOf("") }
    var received by rememberSaveable { mutableStateOf("") }
    var cart by remember { mutableStateOf(emptyMap<Long, PosCartLine>()) }
    var formError by remember { mutableStateOf<String?>(null) }
    var receipt by remember { mutableStateOf<CashierCheckoutResponseDto?>(null) }
    var checkoutKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedCheckoutPayload by remember { mutableStateOf<String?>(null) }

    fun checkoutPayload(
        nextCart: Map<Long, PosCartLine> = cart,
        nextCustomer: String = customer,
        nextReceived: String = received,
    ) = listOf(
        nextCart.toSortedMap().entries.joinToString(",") { "${it.key}:${it.value.quantity}" },
        nextCustomer,
        nextReceived,
    ).joinToString("\u0000")

    fun updateCheckoutKey(nextPayload: String) {
        if (attemptedCheckoutPayload != null && attemptedCheckoutPayload != nextPayload) {
            checkoutKey = UUID.randomUUID().toString()
            attemptedCheckoutPayload = null
        }
    }

    val total = cart.values.fold(java.math.BigDecimal.ZERO) { sum, line ->
        sum + ((line.product.price.toBigDecimalOrNull() ?: java.math.BigDecimal.ZERO) * java.math.BigDecimal(line.quantity))
    }.setScale(2, java.math.RoundingMode.HALF_UP)
    val enteredReceived = received.normalizeArabicDigits().toBigDecimalOrNull()
    val changeDue = if (enteredReceived != null && enteredReceived > total) enteredReceived - total else java.math.BigDecimal.ZERO

    Column(modifier.fillMaxSize().imePadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                searchText,
                { searchText = it },
                label = { Text("اسم المنتج أو الباركود") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch(searchText) }),
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = { onSearch(searchText) }, enabled = !state.isLoading) {
                Icon(Icons.Filled.Search, contentDescription = "بحث عن منتج")
            }
        }
        state.error?.let { ErrorBanner(it) }
        if (state.isLoading && state.products.isEmpty()) LoadingRow()
        else if (state.products.isNotEmpty()) {
            LazyColumn(
                Modifier.weight(0.9f),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(state.products, key = CashierProductDto::id) { product ->
                    Card(
                        shape = RoundedCornerShape(8.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            AsyncImage(
                                model = product.imageUrl,
                                contentDescription = product.name,
                                placeholder = painterResource(android.R.drawable.ic_menu_gallery),
                                error = painterResource(android.R.drawable.ic_menu_gallery),
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.size(44.dp).clip(RoundedCornerShape(6.dp)),
                            )
                            Column(Modifier.weight(1f)) {
                                Text(product.name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("${product.price} ج.م · متوفر ${product.stock}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                product.barcode?.takeIf(String::isNotBlank)?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
                            }
                            Button(
                                enabled = product.stock > 0,
                                onClick = {
                                    val current = cart[product.id]?.quantity ?: 0
                                    if (current < product.stock) {
                                        val updated = cart + (product.id to PosCartLine(product, current + 1))
                                        updateCheckoutKey(checkoutPayload(nextCart = updated))
                                        cart = updated
                                        formError = null
                                    } else formError = "الكمية تتجاوز المخزون المتاح."
                                },
                            ) { Text("إضافة") }
                        }
                    }
                }
            }
        } else {
            EmptyState(if (state.error == null) "ابحث عن منتج أو أضف منتجاً إلى قائمة الأكثر مبيعاً" else "تعذر تحميل المنتجات")
        }

        Column(
            Modifier.fillMaxWidth().weight(1.1f).verticalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("السلة (${cart.values.sumOf { it.quantity }})", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (cart.isEmpty()) Text("السلة فارغة", color = MaterialTheme.colorScheme.onSurfaceVariant)
            cart.values.forEach { line ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(line.product.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${line.product.price} × ${line.quantity}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    IconButton(onClick = {
                        val updated = if (line.quantity <= 1) cart - line.product.id
                        else cart + (line.product.id to line.copy(quantity = line.quantity - 1))
                        updateCheckoutKey(checkoutPayload(nextCart = updated))
                        cart = updated
                    }) { Icon(Icons.Filled.Remove, contentDescription = "تقليل ${line.product.name}") }
                    Text(line.quantity.toString())
                    IconButton(onClick = {
                        if (line.quantity < line.product.stock) {
                            val updated = cart + (line.product.id to line.copy(quantity = line.quantity + 1))
                            updateCheckoutKey(checkoutPayload(nextCart = updated))
                            cart = updated
                        } else formError = "الكمية تتجاوز المخزون المتاح."
                    }) { Icon(Icons.Filled.Add, contentDescription = "زيادة ${line.product.name}") }
                    IconButton(onClick = {
                        val updated = cart - line.product.id
                        updateCheckoutKey(checkoutPayload(nextCart = updated))
                        cart = updated
                    }) { Icon(Icons.Filled.Delete, contentDescription = "إزالة ${line.product.name}") }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("الإجمالي", fontWeight = FontWeight.SemiBold)
                Text("${total.toPlainString()} ج.م", fontWeight = FontWeight.Bold)
            }
            OutlinedTextField(
                customer,
                { updateCheckoutKey(checkoutPayload(nextCustomer = it)); customer = it },
                label = { Text("اسم العميل (مطلوب للدفع الجزئي)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                received,
                { value -> val normalized = value.normalizeArabicDigits(); updateCheckoutKey(checkoutPayload(nextReceived = normalized)); received = normalized },
                label = { Text("المبلغ المستلم (فارغ = دفع كامل)") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (changeDue > java.math.BigDecimal.ZERO) {
                Text("الباقي للعميل: ${changeDue.setScale(2, java.math.RoundingMode.HALF_UP).toPlainString()} ج.م")
            }
            formError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    if (cart.isEmpty()) formError = "أضف منتجاً واحداً على الأقل."
                    else if (received.isNotBlank() && !received.isValidPaidAmount()) formError = "أدخل مبلغاً مستلماً صحيحاً."
                    else if (enteredReceived != null && enteredReceived < total && customer.isBlank()) formError = "اسم العميل مطلوب عند الدفع الجزئي."
                    else {
                        formError = null
                        attemptedCheckoutPayload = checkoutPayload()
                        onCheckout(
                            CashierCheckoutInputDto(
                                customer = customer.trim().ifBlank { null },
                                items = cart.values.map { CashierCheckoutItemDto(it.product.id, it.quantity) },
                                received = received.normalizeArabicDigits().ifBlank { null },
                            ),
                            checkoutKey,
                        ) { result ->
                            receipt = result
                            cart = emptyMap()
                            customer = ""
                            received = ""
                            checkoutKey = UUID.randomUUID().toString()
                            attemptedCheckoutPayload = null
                        }
                    }
                },
                enabled = cart.isNotEmpty() && !isSaving,
                modifier = Modifier.fillMaxWidth(),
            ) {
                if (isSaving) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Text("إتمام البيع")
            }
        }
    }

    receipt?.let { result ->
        AlertDialog(
            onDismissRequest = { receipt = null },
            title = { Text("تمت عملية البيع") },
            text = {
                DialogForm(maxHeight = 360.dp) {
                    Text("الفاتورة ${result.invoiceNumber}")
                    Text("الإجمالي ${result.total} ج.م")
                    Text("المدفوع ${result.paid} ج.م")
                    if (result.remaining != "0.00") Text("المتبقي ${result.remaining} ج.م")
                    if (result.change != "0.00") Text("الباقي للعميل ${result.change} ج.م")
                }
            },
            confirmButton = { Button(enabled = !LocalIsSaving.current, onClick = { receipt = null }) { Text("تم") } },
        )
    }
}

@Composable
private fun SalesListScreen(
    state: RemotePage<SoldProductDto>,
    query: String,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        if (state.items.isEmpty() && state.isLoading) {
            LoadingRow()
        } else if (state.items.isEmpty()) {
            EmptyState(if (state.error != null) "تعذر تحميل تقرير المبيعات" else "لا توجد منتجات مباعة")
        } else {
            LazyColumn(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(state.items, key = SoldProductDto::id) { product ->
                    Card(
                        shape = RoundedCornerShape(8.dp),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(product.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                Text("إجمالي المبيعات", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            Text(product.soldQuantity.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
                item { LoadMoreButton(state, onLoadMore) }
            }
        }
    }
}

@Composable
private fun WalletOverviewScreen(
    state: WalletOverviewUiState,
    canManage: Boolean,
    canUseCashier: Boolean,
    onRefresh: () -> Unit,
    onOpenCashier: () -> Unit,
    onAdjustWallet: (WalletDto) -> Unit,
    onToggleWallet: (Long) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text("ملخص الأرصدة", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (canUseCashier) {
                    TextButton(onClick = onOpenCashier) { Text("المعاملات") }
                }
                IconButton(onClick = onRefresh, enabled = !state.isLoading) {
                    Icon(Icons.Filled.Refresh, contentDescription = "تحديث الأرصدة")
                }
            }
        }
        when {
            state.isLoading && state.overview == null -> LoadingRow()
            state.overview == null -> EmptyState(state.error ?: "لا توجد بيانات محافظ متاحة")
            else -> {
                state.error?.let { ErrorBanner(it) }
                WalletOverviewContent(state.overview, canManage, onAdjustWallet, onToggleWallet)
            }
        }
    }
}

@Composable
private fun WalletOverviewContent(
    overview: WalletOverviewDto,
    canManage: Boolean,
    onAdjustWallet: (WalletDto) -> Unit,
    onToggleWallet: (Long) -> Unit,
) {
    LazyColumn(
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                WalletSummaryLine("إجمالي المحافظ", overview.summary.walletsTotal)
                WalletSummaryLine("النقدية بالصندوق", overview.summary.cash)
                WalletSummaryLine("ربح اليوم", overview.summary.profitToday)
                WalletSummaryLine("المستحق من العملاء", overview.summary.receivables)
                WalletSummaryLine("الربح المتاح", overview.summary.profitAvailable)
                WalletSummaryLine("رأس المال العامل", overview.summary.capital)
            }
        }
        item {
            Text("المحافظ (${overview.wallets.size})", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        if (overview.wallets.isEmpty()) {
            item { EmptyState("لا توجد محافظ مسجلة") }
        } else {
            items(overview.wallets, key = WalletDto::id) { wallet ->
                WalletOverviewRow(wallet, canManage, onAdjustWallet, onToggleWallet)
            }
        }
    }
}

@Composable
private fun WalletSummaryLine(label: String, amount: String) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 11.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("$amount ج.م", fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun WalletOverviewRow(
    wallet: WalletDto,
    canManage: Boolean,
    onAdjustWallet: (WalletDto) -> Unit,
    onToggleWallet: (Long) -> Unit,
) {
    Card(
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(wallet.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text("${wallet.balance} ج.م", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            }
            Text(
                listOfNotNull(wallet.provider.takeIf(String::isNotBlank), wallet.identifier?.takeIf(String::isNotBlank)).joinToString(" · ")
                    .ifBlank { "محفظة بلا بيانات تعريف" },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(if (wallet.isActive) "نشطة" else "موقوفة", style = MaterialTheme.typography.labelSmall,
                color = if (wallet.isActive) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
            wallet.limits.filter { it.limit != null }.forEach { limit ->
                Text("${limit.label}: ${limit.used} / ${limit.limit} ج.م", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (canManage) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { onAdjustWallet(wallet) }) { Text("تسوية الرصيد") }
                    TextButton(onClick = { onToggleWallet(wallet.id) }) {
                        Text(if (wallet.isActive) "إيقاف" else "تفعيل")
                    }
                }
            }
        }
    }
}

@Composable
private fun CategoryListScreen(
    categories: List<CachedCategory>,
    page: RemotePage<CategoryDto>,
    error: String?,
    query: String,
    canManage: Boolean,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onCategoryClick: (CachedCategory) -> Unit,
    onEdit: (CachedCategory) -> Unit,
    onDelete: (CachedCategory) -> Unit,
    modifier: Modifier = Modifier,
) {
    val visible = remember(categories, query) {
        if (query.isBlank()) categories else categories.filter { it.name.contains(query, ignoreCase = true) }
    }
    Column(modifier.fillMaxSize()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        if (error != null) ErrorBanner(error)
        if (visible.isEmpty() && page.isLoading) LoadingRow()
        else if (visible.isEmpty()) EmptyState(if (error != null) "تعذر تحميل التصنيفات" else "لا توجد تصنيفات مطابقة")
        else LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(visible, key = CachedCategory::id) { category ->
                Card(
                    onClick = { onCategoryClick(category) },
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(category.name, style = MaterialTheme.typography.titleMedium)
                            Text("${category.productsCount ?: 0} منتج", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (canManage) {
                            IconButton(onClick = { onEdit(category) }) { Icon(Icons.Filled.Edit, contentDescription = "تعديل ${category.name}") }
                            IconButton(onClick = { onDelete(category) }) { Icon(Icons.Filled.Delete, contentDescription = "حذف ${category.name}") }
                        }
                    }
                }
            }
            item { LoadMoreButton(page, onLoadMore) }
        }
    }
}

@Composable
private fun CustomerListScreen(
    state: RemotePage<CustomerDto>,
    query: String,
    canManage: Boolean,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onCustomerClick: (CustomerDto) -> Unit,
    onEdit: (CustomerDto) -> Unit,
    onDelete: (CustomerDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        if (state.error != null) ErrorBanner(state.error)
        if (state.isLoading && state.items.isEmpty()) LoadingRow()
        else if (state.items.isEmpty()) EmptyState(if (state.error != null) "تعذر تحميل العملاء" else "لا يوجد عملاء")
        else LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.items, key = CustomerDto::id) { customer ->
                Card(
                    onClick = { onCustomerClick(customer) },
                    shape = RoundedCornerShape(8.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(customer.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(customer.phone.orEmpty().ifBlank { "لا يوجد رقم هاتف" }, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (!customer.address.isNullOrBlank()) Text(customer.address, style = MaterialTheme.typography.bodySmall)
                        if (canManage) {
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TextButton(onClick = { onEdit(customer) }) { Icon(Icons.Filled.Edit, contentDescription = null); Spacer(Modifier.width(6.dp)); Text("تعديل") }
                                TextButton(onClick = { onDelete(customer) }) { Icon(Icons.Filled.Delete, contentDescription = null); Spacer(Modifier.width(6.dp)); Text("حذف") }
                            }
                        }
                    }
                }
            }
            item { LoadMoreButton(state, onLoadMore) }
        }
    }
}

@Composable
private fun SupplierListScreen(
    state: RemotePage<SupplierDto>,
    canManage: Boolean,
    query: String,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onSupplierClick: (SupplierDto) -> Unit,
    onEdit: (SupplierDto) -> Unit,
    onDelete: (SupplierDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        if (state.error != null) ErrorBanner(state.error)
        if (state.isLoading && state.items.isEmpty()) LoadingRow()
        else if (state.items.isEmpty()) EmptyState(if (state.error != null) "تعذر تحميل الموردين" else "لا يوجد موردون")
        else LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.items, key = SupplierDto::id) { supplier ->
                Card(
                    onClick = { onSupplierClick(supplier) },
                    shape = RoundedCornerShape(8.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(supplier.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(
                            listOfNotNull(supplier.phone, supplier.email).joinToString("  ·  ").ifBlank { "لا توجد بيانات اتصال" },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("الرصيد المستحق", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(supplier.balance, fontWeight = FontWeight.SemiBold)
                        }
                        if (canManage) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { onEdit(supplier) }, modifier = Modifier.weight(1f)) {
                                Icon(Icons.Filled.Edit, contentDescription = null)
                                Text("تعديل", modifier = Modifier.padding(start = 6.dp))
                            }
                            OutlinedButton(onClick = { onDelete(supplier) }, modifier = Modifier.weight(1f), colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                                Icon(Icons.Filled.Delete, contentDescription = null)
                                Text("حذف", modifier = Modifier.padding(start = 6.dp))
                            }
                        }
                    }
                }
            }
            item { LoadMoreButton(state, onLoadMore) }
        }
    }
}

@Composable
internal fun SearchAndRefresh(query: String, onQueryChange: (String) -> Unit, onRefresh: () -> Unit) {
    val keyboardController = LocalSoftwareKeyboardController.current
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier.weight(1f),
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            placeholder = { Text("بحث") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = { onQueryChange("") }) {
                        Icon(Icons.Filled.Close, contentDescription = "مسح البحث")
                    }
                }
            },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            keyboardActions = KeyboardActions(onSearch = { keyboardController?.hide() }),
        )
        IconButton(onClick = onRefresh) {
            Icon(Icons.Filled.Refresh, contentDescription = "تحديث القائمة")
        }
    }
}

@Composable
private fun CacheStatus(cacheTime: Long?, error: String?) {
    val label = when {
        error != null -> "تعذر التحديث. قد تكون البيانات المعروضة محفوظة محلياً."
        cacheTime == null -> "بيانات المنتجات محفوظة بعد تحميلها."
        else -> "آخر تحديث: ${DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, Locale.forLanguageTag("ar")).format(Date(cacheTime))} · السعر والمخزون للعرض"
    }
    Text(label, Modifier.padding(horizontal = 16.dp, vertical = 6.dp), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
internal fun ErrorBanner(message: String) {
    Surface(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        shape = RoundedCornerShape(12.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Filled.Warning, contentDescription = null, modifier = Modifier.size(20.dp))
            Text(message, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
internal fun EmptyState(message: String) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant, modifier = Modifier.size(72.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Icon(Icons.Filled.Inbox, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(34.dp))
            }
        }
        Spacer(Modifier.height(14.dp))
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

@Composable
internal fun LoadingRow() {
    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
internal fun LoadMoreButton(page: RemotePage<*>, onClick: () -> Unit) {
    if (page.isLoading) {
        Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        }
    } else if (page.currentPage < page.lastPage) {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            TextButton(onClick = onClick) { Text("تحميل المزيد") }
        }
    }
}

private enum class EditKind { Category, Customer, Installment }

private data class EditTarget(
    val kind: EditKind,
    val id: Long? = null,
    val name: String = "",
    val phone: String = "",
    val address: String = "",
)

private data class DeleteTarget(val kind: EditKind, val id: Long, val name: String)

@Composable
private fun StoreEditDialog(
    target: EditTarget,
    onDismiss: () -> Unit,
    onSave: (EditKind, Long?, String, String, String, String) -> Unit,
) {
    var name by remember(target) { mutableStateOf(target.name) }
    var phone by remember(target) { mutableStateOf(target.phone) }
    var address by remember(target) { mutableStateOf(target.address) }
    var requestKey by remember(target) { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember(target) { mutableStateOf<String?>(null) }
    var validationError by remember(target) { mutableStateOf<String?>(null) }

    fun updatePayload(nextName: String = name, nextPhone: String = phone, nextAddress: String = address) {
        val nextPayload = "$nextName\u0000$nextPhone\u0000$nextAddress"
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (target.id == null) "إضافة ${if (target.kind == EditKind.Category) "تصنيف" else "عميل"}" else "تعديل ${if (target.kind == EditKind.Category) "التصنيف" else "العميل"}") },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth().imePadding().heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { updatePayload(nextName = it); name = it },
                    label = { Text("الاسم") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                if (target.kind == EditKind.Customer) {
                    OutlinedTextField(
                        value = phone,
                        onValueChange = { updatePayload(nextPhone = it); phone = it },
                        label = { Text("رقم الهاتف (اختياري)") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = address,
                        onValueChange = { updatePayload(nextAddress = it); address = it },
                        label = { Text("العنوان (اختياري)") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(enabled = !LocalIsSaving.current, onClick = {
                val valid = name.isNotBlank()
                if (!valid) {
                    validationError = "أدخل الاسم."
                } else {
                    validationError = null
                    attemptedPayload = "$name\u0000$phone\u0000$address"
                    onSave(target.kind, target.id, name.trim(), phone.trim(), address.trim(), requestKey)
                }
            }) { Text("حفظ") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

@Composable
private fun InvoiceCreateDialog(
    products: List<CachedProduct>,
    onDismiss: () -> Unit,
    onCreate: (InvoiceInputDto, String) -> Unit,
    onBarcodeLookup: suspend (String) -> ApiResult<ProductDto?>,
    initial: InvoiceDto? = null,
) {
    val initialItems = remember(initial?.id) { initial?.items.orEmpty().filter { it.productId != null && (it.quantity ?: 0) > 0 } }
    var customer by remember(initial?.id) { mutableStateOf(initial?.customer.orEmpty()) }
    var date by remember(initial?.id) { mutableStateOf(initial?.invoiceDate?.take(10) ?: SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())) }
    var paidAmount by remember(initial?.id) { mutableStateOf(initial?.paidAmount ?: "0") }
    var notes by remember(initial?.id) { mutableStateOf(initial?.notes.orEmpty()) }
    var selectedIds by remember(initial?.id) { mutableStateOf(initialItems.mapNotNull { it.productId }.toSet()) }
    var quantities by remember(initial?.id) {
        mutableStateOf(initialItems.associate { (it.productId ?: 0L) to (it.quantity ?: 1).toString() })
    }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember { mutableStateOf<String?>(null) }
    var validationError by remember { mutableStateOf<String?>(null) }
    var productFilter by rememberSaveable { mutableStateOf("") }
    var scannedProducts by remember(initial?.id) {
        mutableStateOf(
            initialItems.associate { item ->
                val id = item.productId ?: 0L
                id to CachedProduct(
                    id = id,
                    name = item.name ?: "منتج #$id",
                    price = item.price ?: "0",
                    description = "",
                    notes = null,
                    barcode = null,
                    stock = 0,
                    categoryId = null,
                    categoryName = null,
                    imageUrl = null,
                    serverUpdatedAt = null,
                    cachedAtEpochMillis = 0L,
                )
            },
        )
    }
    var barcodeStatus by remember { mutableStateOf<String?>(null) }
    var isBarcodeBusy by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val scannerOptions = remember {
        GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(
                Barcode.FORMAT_EAN_13,
                Barcode.FORMAT_EAN_8,
                Barcode.FORMAT_UPC_A,
                Barcode.FORMAT_UPC_E,
                Barcode.FORMAT_CODE_128,
                Barcode.FORMAT_CODE_39,
                Barcode.FORMAT_ITF,
                Barcode.FORMAT_QR_CODE,
            )
            .enableAutoZoom()
            .build()
    }
    val scanner = remember(context, scannerOptions) {
        GmsBarcodeScanning.getClient(context, scannerOptions)
    }

    val invoiceProducts = remember(products, scannedProducts, productFilter) {
        (products + scannedProducts.values)
            .distinctBy(CachedProduct::id)
            .filter { product ->
                productFilter.isBlank() ||
                    product.name.contains(productFilter, ignoreCase = true) ||
                    product.barcode.orEmpty().contains(productFilter, ignoreCase = true)
            }
    }

    fun payload(
        nextCustomer: String = customer,
        nextDate: String = date,
        nextPaidAmount: String = paidAmount,
        nextNotes: String = notes,
        nextIds: Set<Long> = selectedIds,
        nextQuantities: Map<Long, String> = quantities,
    ): String = listOf(
        nextCustomer,
        nextDate,
        nextPaidAmount,
        nextNotes,
        nextIds.sorted().joinToString(","),
        nextIds.sorted().joinToString(",") { nextQuantities[it].orEmpty() },
    ).joinToString("\u0000")

    fun rotateKeyIfChanged(nextPayload: String) {
        if (attemptedPayload != null && attemptedPayload != nextPayload) {
            requestKey = UUID.randomUUID().toString()
            attemptedPayload = null
        }
    }

    suspend fun lookupBarcode(rawCode: String) {
        val barcode = rawCode.trim().normalizeArabicDigits()
        if (barcode.isBlank()) {
            barcodeStatus = "أدخل رمز المنتج أو امسحه أولاً."
            return
        }

        isBarcodeBusy = true
        try {
            when (val result = onBarcodeLookup(barcode)) {
                is ApiResult.Success -> {
                    val product = result.value
                    if (product == null) {
                        barcodeStatus = "لم يتم العثور على منتج بهذا الرمز."
                    } else {
                        val cachedProduct = product.toCachedProduct()
                        val nextIds = selectedIds + cachedProduct.id
                        val nextQuantities = quantities + (cachedProduct.id to (quantities[cachedProduct.id] ?: "1"))
                        rotateKeyIfChanged(payload(nextIds = nextIds, nextQuantities = nextQuantities))
                        scannedProducts = scannedProducts + (cachedProduct.id to cachedProduct)
                        selectedIds = nextIds
                        quantities = nextQuantities
                        productFilter = ""
                        barcodeStatus = "تمت إضافة ${cachedProduct.name} إلى الفاتورة."
                    }
                }
                is ApiResult.Failure -> barcodeStatus = result.error.message
            }
        } finally {
            isBarcodeBusy = false
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "إنشاء فاتورة" else "تعديل الفاتورة ${initial.invoiceNumber}") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .imePadding()
                    .heightIn(max = 560.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(
                    value = customer,
                    onValueChange = { rotateKeyIfChanged(payload(nextCustomer = it)); customer = it },
                    label = { Text("اسم العميل") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                DatePickerField(date, "تاريخ الفاتورة", { value -> rotateKeyIfChanged(payload(nextDate = value)); date = value }, Modifier.fillMaxWidth())
                OutlinedTextField(
                    value = paidAmount,
                    onValueChange = { value ->
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
                    value = notes,
                    onValueChange = { rotateKeyIfChanged(payload(nextNotes = it)); notes = it },
                    label = { Text("ملاحظات") },
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("المنتجات", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text("سيعتمد السعر والمخزون النهائيان على تحقق الخادم.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = productFilter,
                        onValueChange = { productFilter = it },
                        label = { Text("تصفية المنتجات بالاسم أو الرمز") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        enabled = !isBarcodeBusy && productFilter.isNotBlank(),
                        onClick = { coroutineScope.launch { lookupBarcode(productFilter) } },
                    ) {
                        Icon(Icons.Filled.Search, contentDescription = "بحث بالرمز في الخادم")
                    }
                    IconButton(
                        enabled = !isBarcodeBusy,
                        onClick = {
                            isBarcodeBusy = true
                            scanner.startScan()
                                .addOnSuccessListener { scannedBarcode ->
                                    val barcode = scannedBarcode.rawValue?.trim().orEmpty()
                                    if (barcode.isBlank()) {
                                        barcodeStatus = "لم يتضمن الرمز بيانات قابلة للقراءة."
                                        isBarcodeBusy = false
                                    } else {
                                        coroutineScope.launch { lookupBarcode(barcode) }
                                    }
                                }
                                .addOnCanceledListener {
                                    isBarcodeBusy = false
                                }
                                .addOnFailureListener {
                                    barcodeStatus = "تعذر تشغيل الماسح. يمكنك البحث أو الاختيار من القائمة."
                                    isBarcodeBusy = false
                                }
                        },
                    ) {
                        if (isBarcodeBusy) {
                            CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Filled.QrCodeScanner, contentDescription = "مسح باركود")
                        }
                    }
                }
                barcodeStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                if (products.isEmpty() && scannedProducts.isEmpty()) {
                    Text("لا توجد منتجات محملة. ابحث أو امسح رمز منتج عند توفر الاتصال.", color = MaterialTheme.colorScheme.error)
                } else if (invoiceProducts.isEmpty()) {
                    Text("لا توجد منتجات مطابقة للبحث.", color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    invoiceProducts.forEach { product ->
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
                                Text("${product.price}  ·  المخزون المعروض ${product.stock}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            if (checked) {
                                OutlinedTextField(
                                    value = quantities[product.id] ?: "1",
                                    onValueChange = { value ->
                                        val nextQuantities = quantities + (product.id to value.normalizeArabicDigits().filter(Char::isDigit))
                                        rotateKeyIfChanged(payload(nextQuantities = nextQuantities))
                                        quantities = nextQuantities
                                    },
                                    label = { Text("الكمية") },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    singleLine = true,
                                    modifier = Modifier.width(88.dp),
                                )
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
                val validPaidAmount = paidAmount.isValidPaidAmount()
                if (
                    customer.isBlank() ||
                    !date.isValidInvoiceDate() ||
                    selectedIds.isEmpty() ||
                    validQuantities.size != selectedIds.size ||
                    validQuantities.any { it <= 0 } ||
                    !validPaidAmount
                ) {
                    validationError = "أدخل عميلاً وتاريخاً صحيحاً ومبلغاً غير سالب بمنزلتين عشريتين، وحدد منتجاً بكمية صحيحة."
                } else {
                    validationError = null
                    attemptedPayload = payload()
                    val productIds = selectedIds.sorted()
                    onCreate(
                        InvoiceInputDto(
                            customer = customer.trim(),
                            productIds = productIds,
                            quantities = productIds.map { quantities.getValue(it).toInt() },
                            invoiceDate = date,
                            paidAmount = paidAmount,
                            notes = notes.ifBlank { null },
                        ),
                        requestKey,
                    )
                }
            }) { Text(if (initial == null) "إرسال الفاتورة" else "حفظ التعديلات") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

