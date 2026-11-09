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
}
