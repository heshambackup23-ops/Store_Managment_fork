package com.storemanagement.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.ReceiptLong
import androidx.compose.material.icons.filled.Category
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Store
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.material3.Switch
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
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
import com.storemanagement.mobile.core.network.ProductDto
import com.storemanagement.mobile.core.network.SupplierDto
import com.storemanagement.mobile.core.network.UserDto
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
) {
    val session by sessionViewModel.state.collectAsStateWithLifecycle()
    val darkTheme by storeViewModel.isDarkTheme.collectAsStateWithLifecycle()
    val currentUser = session.user

    StoreTheme(darkTheme = darkTheme) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            when {
                session.isRestoring -> LoadingScreen()
                currentUser == null -> LoginScreen(
                    error = session.error,
                    isSubmitting = session.isSubmitting,
                    onLogin = sessionViewModel::login,
                    onRetry = sessionViewModel::restoreSession,
                )
                else -> StoreHomeScreen(
                    user = currentUser,
                    storeViewModel = storeViewModel,
                    onLogout = sessionViewModel::logout,
                    onSessionExpired = sessionViewModel::expireSession,
                )
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

    Column(
        modifier = Modifier
            .fillMaxSize()
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
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("كلمة المرور") },
            singleLine = true,
            visualTransformation = if (showPassword) androidx.compose.ui.text.input.VisualTransformation.None
            else PasswordVisualTransformation(),
            trailingIcon = {
                TextButton(onClick = { showPassword = !showPassword }) {
                    Text(if (showPassword) "إخفاء" else "إظهار")
                }
            },
            modifier = Modifier.fillMaxWidth(),
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
            onClick = { onLogin(username, password) },
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

private enum class StoreTab(val label: String, val permission: String?, val icon: ImageVector) {
    Dashboard("الرئيسية", null, Icons.Filled.Store),
    Products("المنتجات", "page.products.view", Icons.Filled.Inventory2),
    Customers("العملاء", "page.customers.view", Icons.Filled.People),
    Invoices("الفواتير", "page.invoices.view", Icons.AutoMirrored.Filled.ReceiptLong),
    More("المزيد", null, Icons.Filled.MoreHoriz),
}

private enum class MoreSection { Home, Categories, Suppliers, Installments, Profile }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun StoreHomeScreen(
    user: UserDto,
    storeViewModel: StoreViewModel,
    onLogout: () -> Unit,
    onSessionExpired: () -> Unit,
) {
    val darkTheme by storeViewModel.isDarkTheme.collectAsStateWithLifecycle()
    val products by storeViewModel.products.collectAsStateWithLifecycle()
    val cacheTime by storeViewModel.productCacheTime.collectAsStateWithLifecycle()
    val categories by storeViewModel.categories.collectAsStateWithLifecycle()
    val customers by storeViewModel.customers.collectAsStateWithLifecycle()
    val invoices by storeViewModel.invoices.collectAsStateWithLifecycle()
    val suppliers by storeViewModel.suppliers.collectAsStateWithLifecycle()
    val installments by storeViewModel.installments.collectAsStateWithLifecycle()
    val productPage by storeViewModel.productPage.collectAsStateWithLifecycle()
    val productDetails by storeViewModel.productDetails.collectAsStateWithLifecycle()
    val invoiceDetails by storeViewModel.invoiceDetails.collectAsStateWithLifecycle()
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
    var moreSectionName by rememberSaveable { mutableStateOf(MoreSection.Home.name) }
    val moreSection = MoreSection.entries.firstOrNull { it.name == moreSectionName } ?: MoreSection.Home
    var selectedProductCategoryId by rememberSaveable { mutableStateOf<Long?>(null) }
    var productStockFilter by rememberSaveable { mutableStateOf<Boolean?>(null) }
    val activeTab = StoreTab.entries.firstOrNull { it.name == selectedTab && it in availableTabs }
        ?: StoreTab.Dashboard
    val activeTitle = if (activeTab == StoreTab.More && moreSection != MoreSection.Home) {
        when (moreSection) {
            MoreSection.Categories -> "التصنيفات"
            MoreSection.Suppliers -> "الموردون"
            MoreSection.Installments -> "الأقساط"
            MoreSection.Profile -> "حسابي"
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
    }

    LaunchedEffect(storeViewModel) {
        storeViewModel.events.collectLatest { event ->
            when (event) {
                is StoreEvent.Saved -> {
                    editor = null
                    deleteTarget = null
                    invoiceDialogOpen = false
                    snackbars.showSnackbar(event.message)
                }
                is StoreEvent.Failed -> snackbars.showSnackbar(event.message)
                StoreEvent.SessionExpired -> {
                    editor = null
                    deleteTarget = null
                    invoiceDialogOpen = false
                    selectedProduct = null
                    selectedInvoice = null
                    selectedSupplier = null
                    selectedInstallment = null
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

    LaunchedEffect(activeTab, searchQuery, selectedProductCategoryId, productStockFilter, moreSection) {
        delay(300)
        when (activeTab) {
            StoreTab.Products -> storeViewModel.refreshProducts(
                searchQuery.ifBlank { null },
                categoryId = selectedProductCategoryId,
                inStock = productStockFilter,
            )
            StoreTab.Customers -> storeViewModel.refreshCustomers(searchQuery.ifBlank { null })
            StoreTab.Invoices -> storeViewModel.refreshInvoices(searchQuery.ifBlank { null })
            StoreTab.More -> if (moreSection == MoreSection.Suppliers) {
                storeViewModel.refreshSuppliers(searchQuery.ifBlank { null })
            } else if (moreSection == MoreSection.Installments) {
                storeViewModel.refreshInstallments(searchQuery.ifBlank { null })
            }
            StoreTab.Dashboard -> Unit
        }
    }

    Scaffold(
        topBar = {
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
                    IconButton(onClick = onLogout) {
                        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "تسجيل الخروج")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbars) },
        floatingActionButton = {
            when {
                activeTab == StoreTab.More && moreSection == MoreSection.Categories && "page.categories.manage" in user.permissions -> {
                    FloatingActionButton(onClick = { editor = EditTarget(EditKind.Category) }) {
                        Icon(Icons.Filled.Add, contentDescription = "إضافة تصنيف")
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
                availableTabs.forEach { tab ->
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
    ) { padding ->
        when (activeTab) {
            StoreTab.Dashboard -> DashboardScreen(
                user = user,
                productsCount = products.size,
                categoriesCount = categories.size,
                customersCount = customers.total,
                invoicesCount = invoices.total,
                isDarkTheme = storeViewModel.isDarkTheme.collectAsState().value,
                onDarkThemeChange = storeViewModel::setDarkTheme,
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
                modifier = Modifier.padding(padding),
            )
            StoreTab.Customers -> CustomerListScreen(
                state = customers,
                query = searchQuery,
                canManage = "page.customers.manage" in user.permissions,
                onQueryChange = { searchQuery = it },
                onRefresh = { storeViewModel.refreshCustomers(searchQuery.ifBlank { null }) },
                onLoadMore = storeViewModel::loadMoreCustomers,
                onEdit = { editor = EditTarget(EditKind.Customer, it.id, it.name, it.phone.orEmpty(), it.address) },
                onDelete = { deleteTarget = DeleteTarget(EditKind.Customer, it.id, it.name) },
                onCustomerClick = {
                    selectedCustomer = it
                    storeViewModel.loadCustomerDetails(it.id)
                },
                modifier = Modifier.padding(padding),
            )
            StoreTab.Invoices -> InvoiceListScreen(
                state = invoices,
                query = searchQuery,
                onQueryChange = { searchQuery = it },
                onRefresh = { storeViewModel.refreshInvoices(searchQuery.ifBlank { null }) },
                onLoadMore = storeViewModel::loadMoreInvoices,
                onInvoiceClick = {
                    selectedInvoice = it
                    storeViewModel.loadInvoiceDetails(it.id)
                },
                modifier = Modifier.padding(padding),
            )
            StoreTab.More -> when (moreSection) {
                MoreSection.Home -> MoreHubScreen(
                    canViewCategories = "page.categories.view" in user.permissions,
                    canViewSuppliers = "page.suppliers.view" in user.permissions,
                    canViewInstallments = "page.installments.view" in user.permissions,
                    onOpenProfile = {
                        moreSectionName = MoreSection.Profile.name
                        searchQuery = ""
                    },
                    isDarkTheme = darkTheme,
                    onDarkThemeChange = storeViewModel::setDarkTheme,
                    onOpenCategories = {
                        moreSectionName = MoreSection.Categories.name
                        searchQuery = ""
                    },
                    onOpenSuppliers = {
                        moreSectionName = MoreSection.Suppliers.name
                        searchQuery = ""
                    },
                    onOpenInstallments = {
                        moreSectionName = MoreSection.Installments.name
                        searchQuery = ""
                    },
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
                MoreSection.Suppliers -> SupplierListScreen(
                    state = suppliers,
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    onRefresh = { storeViewModel.refreshSuppliers(searchQuery.ifBlank { null }) },
                    onLoadMore = storeViewModel::loadMoreSuppliers,
                    onSupplierClick = {
                        selectedSupplier = it
                        storeViewModel.loadSupplierDetails(it.id)
                    },
                    modifier = Modifier.padding(padding),
                )
                MoreSection.Profile -> ProfileScreen(user, Modifier.padding(padding))
                MoreSection.Installments -> InstallmentListScreen(
                    state = installments,
                    query = searchQuery,
                    onQueryChange = { searchQuery = it },
                    onRefresh = { storeViewModel.refreshInstallments(searchQuery.ifBlank { null }) },
                    onLoadMore = storeViewModel::loadMoreInstallments,
                    onInstallmentClick = {
                        selectedInstallment = it
                        storeViewModel.loadInstallmentDetails(it.id)
                    },
                    modifier = Modifier.padding(padding),
                )
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
                        val input = CustomerInputDto(name, phone, address)
                        if (id == null) storeViewModel.createCustomer(input, key)
                        else storeViewModel.updateCustomer(id, input)
                    }
                }
            },
        )
    }

    deleteTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("تأكيد الحذف") },
            text = { Text("هل تريد حذف ${target.name}؟") },
            confirmButton = {
                Button(onClick = {
                    when (target.kind) {
                        EditKind.Category -> storeViewModel.deleteCategory(target.id)
                        EditKind.Customer -> storeViewModel.deleteCustomer(target.id)
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
            InvoiceDetailsSheet(cached, invoiceDetails)
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
private fun DashboardScreen(
    user: UserDto,
    productsCount: Int,
    categoriesCount: Int,
    customersCount: Int,
    invoicesCount: Int,
    isDarkTheme: Boolean,
    onDarkThemeChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("مرحباً، ${user.name}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Text("ملخص البيانات المتاحة لحسابك", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatTile("منتجات محملة", productsCount, Icons.Filled.Inventory2, Modifier.weight(1f))
            StatTile("تصنيفات", categoriesCount, Icons.Filled.Category, Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatTile("عملاء", customersCount, Icons.Filled.People, Modifier.weight(1f))
            StatTile("فواتير", invoicesCount, Icons.AutoMirrored.Filled.ReceiptLong, Modifier.weight(1f))
        }
        Card(shape = RoundedCornerShape(8.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(if (isDarkTheme) Icons.Filled.DarkMode else Icons.Filled.LightMode, contentDescription = null)
                    Text("المظهر الداكن")
                }
                Switch(checked = isDarkTheme, onCheckedChange = onDarkThemeChange)
            }
        }
        Text("عدد الأدوار: ${user.roles.size}", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun StatTile(label: String, count: Int, icon: ImageVector, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Text(count.toString(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    onQueryChange: (String) -> Unit,
    onCategoryChange: (Long?) -> Unit,
    onStockFilterChange: (Boolean?) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onProductClick: (CachedProduct) -> Unit,
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
    Column(modifier.fillMaxSize()) {
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
                items(visible, key = CachedProduct::id) { product -> ProductRow(product, onClick = { onProductClick(product) }) }
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
private fun ProductRow(product: CachedProduct, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
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
    }
}

private fun ProductDto.toCachedProduct() = CachedProduct(
    id = id,
    name = name,
    price = price,
    description = description,
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
private fun InvoiceDetailsSheet(cached: InvoiceDto, state: InvoiceDetailUiState) {
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
        DetailLine("العنوان", customer.address.ifBlank { "غير متوفر" })
    }
}

@Composable
private fun DetailLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun ProfileScreen(user: UserDto, modifier: Modifier = Modifier) {
    val permissionLabels = remember(user.permissions) {
        user.permissions.mapNotNull(String::toArabicPermissionLabel).distinct().sorted()
    }
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("حسابي", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        DetailLine("الاسم", user.name)
        DetailLine("اسم المستخدم", user.username?.ifBlank { null } ?: "غير محدد")
        DetailLine("عدد الأدوار", user.roles.size.toString())
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
    canViewSuppliers: Boolean,
    canViewInstallments: Boolean,
    onOpenProfile: () -> Unit,
    isDarkTheme: Boolean,
    onDarkThemeChange: (Boolean) -> Unit,
    onOpenCategories: () -> Unit,
    onOpenSuppliers: () -> Unit,
    onOpenInstallments: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("إدارة البيانات", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Card(
            onClick = onOpenProfile,
            shape = RoundedCornerShape(8.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Filled.AccountCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text("حسابي", style = MaterialTheme.typography.titleMedium)
            }
        }
        if (canViewCategories) {
            Card(
                onClick = onOpenCategories,
                shape = RoundedCornerShape(8.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Filled.Category, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text("التصنيفات", style = MaterialTheme.typography.titleMedium)
                }
            }
        }
        if (canViewSuppliers) {
            Card(
                onClick = onOpenSuppliers,
                shape = RoundedCornerShape(8.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Filled.People, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text("الموردون والحسابات الدائنة", style = MaterialTheme.typography.titleMedium)
                }
            }
        }
        if (canViewInstallments) {
            Card(
                onClick = onOpenInstallments,
                shape = RoundedCornerShape(8.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.AutoMirrored.Filled.ReceiptLong, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Text("الأقساط والديون", style = MaterialTheme.typography.titleMedium)
                }
            }
        }
        Text("المظهر", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Card(shape = RoundedCornerShape(8.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(if (isDarkTheme) Icons.Filled.DarkMode else Icons.Filled.LightMode, contentDescription = null)
                    Text("المظهر الداكن")
                }
                Switch(checked = isDarkTheme, onCheckedChange = onDarkThemeChange)
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
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(customer.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(customer.phone.orEmpty().ifBlank { "لا يوجد رقم هاتف" }, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (customer.address.isNotBlank()) Text(customer.address, style = MaterialTheme.typography.bodySmall)
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
private fun InstallmentListScreen(
    state: RemotePage<InstallmentDto>,
    query: String,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onInstallmentClick: (InstallmentDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        if (state.error != null) ErrorBanner(state.error)
        if (state.isLoading && state.items.isEmpty()) LoadingRow()
        else if (state.items.isEmpty()) EmptyState(if (state.error != null) "تعذر تحميل الأقساط" else "لا توجد أقساط")
        else LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.items, key = InstallmentDto::id) { installment ->
                Card(
                    onClick = { onInstallmentClick(installment) },
                    shape = RoundedCornerShape(8.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(installment.customer, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                            Text(installment.status.toArabicInstallmentStatus(), color = MaterialTheme.colorScheme.primary)
                        }
                        Text(installment.productName, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("المتبقي", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(installment.remaining, fontWeight = FontWeight.SemiBold)
                        }
                        Text(
                            "موعد السداد: ${installment.nextPaymentDate?.toArabicDateDisplay() ?: "غير محدد"}",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
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
    query: String,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onSupplierClick: (SupplierDto) -> Unit,
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
                    }
                }
            }
            item { LoadMoreButton(state, onLoadMore) }
        }
    }
}

@Composable
private fun InvoiceListScreen(
    state: RemotePage<InvoiceDto>,
    query: String,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onInvoiceClick: (InvoiceDto) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        SearchAndRefresh(query, onQueryChange, onRefresh)
        if (state.error != null) ErrorBanner(state.error)
        if (state.isLoading && state.items.isEmpty()) LoadingRow()
        else if (state.items.isEmpty()) EmptyState(if (state.error != null) "تعذر تحميل الفواتير" else "لا توجد فواتير")
        else LazyColumn(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.items, key = InvoiceDto::id) { invoice ->
                Card(
                    onClick = { onInvoiceClick(invoice) },
                    shape = RoundedCornerShape(8.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                ) {
                    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("فاتورة ${invoice.invoiceNumber}", fontWeight = FontWeight.SemiBold)
                            Text(invoice.status.toArabicInvoiceStatus(), color = MaterialTheme.colorScheme.primary)
                        }
                        Text(invoice.customer, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(invoice.invoiceDate.toArabicDateDisplay())
                            Text("الإجمالي  ${invoice.totalAmount}", fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }
            item { LoadMoreButton(state, onLoadMore) }
        }
    }
}

@Composable
private fun SearchAndRefresh(query: String, onQueryChange: (String) -> Unit, onRefresh: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier.weight(1f),
            singleLine = true,
            placeholder = { Text("بحث") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
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
private fun ErrorBanner(message: String) {
    Text(message, Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), color = MaterialTheme.colorScheme.error)
}

@Composable
private fun EmptyState(message: String) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LoadingRow() {
    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun LoadMoreButton(page: RemotePage<*>, onClick: () -> Unit) {
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

private enum class EditKind { Category, Customer }

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
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
                        label = { Text("رقم الهاتف") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = address,
                        onValueChange = { updatePayload(nextAddress = it); address = it },
                        label = { Text("العنوان") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                validationError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            Button(onClick = {
                val valid = name.isNotBlank() && (target.kind == EditKind.Category || (phone.isNotBlank() && address.isNotBlank()))
                if (!valid) {
                    validationError = if (target.kind == EditKind.Customer) "أكمل الاسم والهاتف والعنوان." else "أدخل اسم التصنيف."
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
) {
    var customer by remember { mutableStateOf("") }
    var date by remember { mutableStateOf(SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())) }
    var paidAmount by remember { mutableStateOf("0") }
    var notes by remember { mutableStateOf("") }
    var selectedIds by remember { mutableStateOf(emptySet<Long>()) }
    var quantities by remember { mutableStateOf(emptyMap<Long, String>()) }
    var requestKey by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var attemptedPayload by remember { mutableStateOf<String?>(null) }
    var validationError by remember { mutableStateOf<String?>(null) }
    var productFilter by rememberSaveable { mutableStateOf("") }
    var scannedProducts by remember { mutableStateOf(emptyMap<Long, CachedProduct>()) }
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
        title = { Text("إنشاء فاتورة") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
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
                OutlinedTextField(
                    value = date,
                    onValueChange = { value ->
                        val normalized = value.normalizeArabicDigits()
                        rotateKeyIfChanged(payload(nextDate = normalized))
                        date = normalized
                    },
                    label = { Text("تاريخ الفاتورة (سنة-شهر-يوم)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
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
            Button(onClick = {
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
            }) { Text("إرسال الفاتورة") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("إلغاء") } },
    )
}

