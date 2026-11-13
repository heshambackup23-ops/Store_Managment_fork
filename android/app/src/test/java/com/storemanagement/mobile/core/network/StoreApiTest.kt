package com.storemanagement.mobile.core.network

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class StoreApiTest {
    private lateinit var server: MockWebServer
    private lateinit var api: StoreApi

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        api = Retrofit.Builder()
            .baseUrl(server.url("/api/"))
            .client(OkHttpClient())
            .addConverterFactory(Json { ignoreUnknownKeys = true }.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(StoreApi::class.java)
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    @Test
    fun productsSendSearchCategoryStockAndPaginationFilters() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":[],"links":{"next":null,"prev":null},"meta":{"current_page":2,"last_page":3,"per_page":10,"total":21}}"""),
        )

        val result = api.products(query = "Phone Model", categoryId = 7, inStock = false, page = 2, perPage = 10)
        val requestUrl = server.takeRequest().requestUrl!!

        assertEquals(2, result.meta?.currentPage)
        assertEquals("Phone Model", requestUrl.queryParameter("q"))
        assertEquals("7", requestUrl.queryParameter("category_id"))
        assertEquals("false", requestUrl.queryParameter("in_stock"))
        assertEquals("2", requestUrl.queryParameter("page"))
        assertEquals("10", requestUrl.queryParameter("per_page"))
    }

    @Test
    fun barcodeSearchUsesTheExistingProductQueryContract() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":[{"id":42,"name":"Phone Model A","price":"125.50","description":"","barcode":"0123456789012","stock":3,"category":null,"image_url":null,"updated_at":"2026-11-09T10:00:00Z"}],"links":{"next":null,"prev":null},"meta":{"current_page":1,"last_page":1,"per_page":100,"total":1}}"""),
        )

        val result = api.products(query = "0123456789012", page = 1, perPage = 100)
        val requestUrl = server.takeRequest().requestUrl!!

        assertEquals("0123456789012", result.data.single().barcode)
        assertEquals("0123456789012", requestUrl.queryParameter("q"))
        assertEquals("100", requestUrl.queryParameter("per_page"))
    }

    @Test
    fun productDetailDecodesTheAuthorizedResourceEnvelope() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """{"data":{"id":42,"name":"Phone Model A","price":"125.50","description":"Phone description","barcode":"PHONE-A","stock":3,"category":{"id":7,"name":"Phones"},"image_url":null,"updated_at":"2026-11-09T10:00:00Z"}}""",
                ),
        )

        val product = api.product(42).data
        val request = server.takeRequest()

        assertEquals("/api/v1/products/42", request.path)
        assertEquals(42L, product.id)
        assertEquals("125.50", product.price)
        assertEquals("Phones", product.category?.name)
    }

    @Test
    fun categoryCustomerSupplierAndInvoiceDetailsUseVersionedRoutes() = runBlocking {
        listOf(
            """{"data":{"id":7,"name":"Phones","products_count":3}}""",
            """{"data":{"id":11,"name":"عميل","phone":"01012345678","address":"Cairo"}}""",
            """{"data":{"id":13,"name":"مورد","phone":null,"email":null,"address":null,"opening_balance":"0.00","balance":"25.00","purchases_count":2}}""",
            """{"data":{"id":17,"invoice_number":"INV-17","customer":"عميل","invoice_date":"2026-11-09","status":"unpaid","quantity":1,"total_amount":"25.00","paid_amount":"0.00","remaining_amount":"25.00","items":[]}}""",
        ).forEach { body ->
            server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(body))
        }

        assertEquals(3, api.category(7).data.productsCount)
        assertEquals("01012345678", api.customer(11).data.phone)
        assertEquals("25.00", api.supplier(13).data.balance)
        assertEquals("INV-17", api.invoice(17).data.invoiceNumber)

        assertEquals("/api/v1/categories/7", server.takeRequest().path)
        assertEquals("/api/v1/customers/11", server.takeRequest().path)
        assertEquals("/api/v1/suppliers/13", server.takeRequest().path)
        assertEquals("/api/v1/invoices/17", server.takeRequest().path)
    }

    @Test
    fun installmentListAndDetailUseReadOnlyVersionedRoutes() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":[],"links":{"next":null,"prev":null},"meta":{"current_page":2,"last_page":2,"per_page":10,"total":11}}"""),
        )
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """{"data":{"id":21,"invoice_id":null,"customer_id":null,"customer":"فاطمة","product_id":null,"product_name":"هاتف سامسونج","product_price":"100.00","payment_date":"2026-11-01","next_payment_date":"2026-12-01","paid_amount":"25.00","remaining":"75.00","quantity":1,"status":"غير مكتمل","items":[]}}""",
                ),
        )

        val page = api.installments(query = "فاطمة", page = 2, perPage = 10)
        val installment = api.installment(21).data
        val listRequest = server.takeRequest()
        val detailRequest = server.takeRequest()

        assertEquals(2, page.meta?.currentPage)
        assertEquals("فاطمة", listRequest.requestUrl?.queryParameter("q"))
        assertEquals("/api/v1/installments", listRequest.requestUrl?.encodedPath)
        assertEquals("/api/v1/installments/21", detailRequest.path)
        assertEquals("75.00", installment.remaining)
        assertEquals("غير مكتمل", installment.status)
    }

    @Test
    fun installmentListAndDetailAreDecodedFromTheApiContract() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":[],"links":{"next":null,"prev":null},"meta":{"current_page":1,"last_page":1,"per_page":20,"total":0}}"""),
        )
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody(
                    """{"data":{"id":21,"invoice_id":null,"customer_id":null,"customer":"فاطمة","product_id":null,"product_name":"هاتف سامسونج","product_price":"100.00","payment_date":"2026-11-01","next_payment_date":"2026-12-01","paid_amount":"25.00","remaining":"75.00","quantity":1,"status":"غير مكتمل","items":[]}}""",
                ),
        )

        val list = api.installments(query = "فاطمة")
        val installment = api.installment(21).data
        val listRequest = server.takeRequest()
        val detailRequest = server.takeRequest()

        assertEquals(0, list.meta?.total)
        assertEquals("فاطمة", listRequest.requestUrl?.queryParameter("q"))
        assertEquals("/api/v1/installments", listRequest.requestUrl?.encodedPath)
        assertEquals("/api/v1/installments/21", detailRequest.path)
        assertEquals("75.00", installment.remaining)
        assertEquals("غير مكتمل", installment.status)
    }

    @Test
    fun supplierAndInstallmentCreationAndWalletOverviewUseTheirAuthorizedContracts() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":{"id":4,"name":"مورد","phone":null,"email":null,"address":null,"opening_balance":"25.00","balance":"25.00"}}"""),
        )
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":{"id":8,"invoice_id":null,"customer_id":12,"customer":"ليلى","product_id":3,"product_name":"هاتف","product_price":"100.00","payment_date":null,"next_payment_date":"2026-12-09","paid_amount":"0.00","remaining":"100.00","quantity":1,"status":"غير مكتمل","items":[]}}"""),
        )
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":{"summary":{"wallets_total":"250.00","cash":"0.00","profit_today":"0.00","profit_available":"0.00","receivables":"0.00","capital":"250.00"},"wallets":[{"id":2,"name":"المحفظة الرئيسية","provider":"فودافون كاش","identifier":"01012345678","balance":"250.00","is_active":true,"warn_at_percent":80,"limits":[]}]}}"""),
        )

        val supplier = api.createSupplier("supplier-key-0001", SupplierInputDto("مورد", openingBalance = "25.00")).data
        val installment = api.createInstallment(
            "installment-key-001",
            InstallmentInputDto("ليلى", listOf(3), listOf(1), nextPaymentDate = "2026-12-09", paidAmount = "0.00"),
        ).data
        val wallets = api.wallets().data
        val supplierRequest = server.takeRequest()
        val installmentRequest = server.takeRequest()
        val walletRequest = server.takeRequest()

        assertEquals("25.00", supplier.balance)
        assertEquals("100.00", installment.remaining)
        assertEquals("250.00", wallets.summary.walletsTotal)
        assertEquals("فودافون كاش", wallets.wallets.single().provider)
        assertEquals("/api/v1/suppliers", supplierRequest.path)
        assertEquals("supplier-key-0001", supplierRequest.getHeader("Idempotency-Key"))
        assertEquals("/api/v1/installments", installmentRequest.path)
        assertEquals("installment-key-001", installmentRequest.getHeader("Idempotency-Key"))
        assertEquals("/api/v1/wallets", walletRequest.path)
    }

    @Test
    fun salesReportUsesTheAuthorizedPaginatedRoute() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":[{"id":12,"name":"Phone A","sold_quantity":7}],"links":{"next":null,"prev":null},"meta":{"current_page":1,"last_page":1,"per_page":20,"total":1}}"""),
        )

        val report = api.sales(query = "Phone")
        val request = server.takeRequest()

        assertEquals("Phone A", report.data.single().name)
        assertEquals(7, report.data.single().soldQuantity)
        assertEquals("/api/v1/sales", request.requestUrl?.encodedPath)
        assertEquals("Phone", request.requestUrl?.queryParameter("q"))
    }

    @Test
    fun notificationInboxAndReadActionsUseUserScopedRoutes() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":[{"id":9,"title":"تنبيه","message":"رسالة","starts_at":null,"ends_at":null,"created_at":"2026-11-09T10:00:00Z","is_read":false}],"links":{"next":null,"prev":null},"meta":{"current_page":1,"last_page":1,"per_page":20,"total":1}}"""),
        )
        server.enqueue(MockResponse().setResponseCode(204))
        server.enqueue(MockResponse().setResponseCode(204))

        val page = api.notifications(page = 1, perPage = 20)
        api.markNotificationRead(9)
        api.markAllNotificationsRead()
        val listRequest = server.takeRequest()
        val readRequest = server.takeRequest()
        val readAllRequest = server.takeRequest()

        assertEquals(false, page.data.single().isRead)
        assertEquals("/api/v1/notifications", listRequest.requestUrl?.encodedPath)
        assertEquals("/api/v1/notifications/9/read", readRequest.path)
        assertEquals("POST", readRequest.method)
        assertEquals("/api/v1/notifications/read-all", readAllRequest.path)
        assertEquals("POST", readAllRequest.method)
    }

    @Test
    fun maintenanceListDecodesItsReadOnlyResourceContract() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":[{"id":5,"name":"Repair","owner":"Omar","phone":"01010000000","address":"Cairo","description":"Screen replacement","status":"قيد الصيانة","requested_date":"2026-11-09","completed_date":null}],"links":{"next":null,"prev":null},"meta":{"current_page":1,"last_page":1,"per_page":20,"total":1}}"""),
        )

        val result = api.maintenance(query = "Omar")
        val request = server.takeRequest()

        assertEquals("Repair", result.data.single().name)
        assertEquals("قيد الصيانة", result.data.single().status)
        assertEquals("/api/v1/maintenance", request.requestUrl?.encodedPath)
        assertEquals("Omar", request.requestUrl?.queryParameter("q"))
    }
    @Test
    fun restrictedWalletOverviewAllowsOmittedCashDetails() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":{"summary":{"wallets_total":"10.00","receivables":"0.00"},"wallets":[]}}"""),
        )

        val result = api.wallets().data
        assertEquals("10.00", result.summary.walletsTotal)
        assertEquals(null, result.summary.cash)
        assertEquals(null, result.summary.profitAvailable)
        assertEquals("/api/v1/wallets", server.takeRequest().path)
    }

    @Test
    fun maintenanceUpdateSendsItsRetryKey() = runBlocking {
        server.enqueue(
            MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""{"data":{"id":7,"name":"جهاز","owner":"عميل","status":"مكتمل","requested_date":"2026-01-01"}}"""),
        )
        val result = api.updateMaintenance(
            7, "maintenance-edit-test",
            MaintenanceInputDto(name = "جهاز", owner = "عميل", status = "مكتمل", requestedDate = "2026-01-01"),
        ).data
        val request = server.takeRequest()
        assertEquals("مكتمل", result.status)
        assertEquals("PUT", request.method)
        assertEquals("/api/v1/maintenance/7", request.path)
        assertEquals("maintenance-edit-test", request.getHeader("Idempotency-Key"))
    }

}
