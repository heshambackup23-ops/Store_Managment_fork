package com.storemanagement.mobile.core.network

import retrofit2.Response
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Part
import retrofit2.http.Multipart
import retrofit2.http.Streaming

interface StoreApi {
    @Streaming
    @GET("v1/backup")
    suspend fun downloadBackup(@Query("pages[]") pages: List<String>): ResponseBody

    @Multipart
    @POST("v1/backup/import")
    suspend fun importBackup(
        @Part file: MultipartBody.Part,
        @Part("pages") pages: RequestBody,
    ): Response<ResponseBody>

    @POST("v1/auth/token")
    suspend fun issueToken(@Body body: LoginRequestDto): TokenResponse

    @GET("v1/me")
    suspend fun currentUser(): ApiEnvelope<UserDto>

    @GET("v1/profile")
    suspend fun profile(): ApiEnvelope<ProfileDto>

    @PUT("v1/profile")
    suspend fun updateProfile(@Body body: ProfileInputDto): ApiEnvelope<ProfileDto>

    @GET("v1/damaged")
    suspend fun damagedItems(
        @Query("q") query: String? = null,
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<DamagedItemDto>

    @GET("v1/damaged/products")
    suspend fun damagedProducts(@Query("q") query: String? = null): ApiEnvelope<List<DamagedProductDto>>

    @POST("v1/damaged")
    suspend fun createDamagedItem(
        @Header("Idempotency-Key") key: String,
        @Body body: DamagedItemInputDto,
    ): ApiEnvelope<DamagedItemDto>

    @POST("v1/damaged/{item}/void")
    suspend fun voidDamagedItem(
        @Path("item") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: VoidDamagedItemInputDto,
    ): ApiEnvelope<DamagedItemDto>

    @PUT("v1/damaged/{item}")
    suspend fun updateDamagedItem(
        @Path("item") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: DamagedItemInputDto,
    ): ApiEnvelope<DamagedItemDto>

    @POST("v1/invoices/{invoice}/refund")
    suspend fun refundInvoice(
        @Path("invoice") id: Long,
        @Header("Idempotency-Key") key: String,
    ): ApiEnvelope<InvoiceDto>

    @DELETE("v1/auth/token")
    suspend fun revokeCurrentToken(): Response<Unit>

    @GET("v1/products")
    suspend fun products(
        @Query("q") query: String? = null,
        @Query("category_id") categoryId: Long? = null,
        @Query("in_stock") inStock: Boolean? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<ProductDto>

    @POST("v1/products")
    suspend fun createProduct(
        @Header("Idempotency-Key") key: String,
        @Body body: ProductInputDto,
    ): ApiEnvelope<ProductDto>

    @PUT("v1/products/{product}")
    suspend fun updateProduct(
        @Path("product") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: ProductInputDto,
    ): ApiEnvelope<ProductDto>

    @Streaming
    @GET("v1/products/{product}/image")
    suspend fun productImage(@Path("product") id: Long): ResponseBody

    @Multipart
    @POST("v1/products/{product}/image")
    suspend fun updateProductImage(
        @Path("product") id: Long,
        @Part image: MultipartBody.Part,
    ): ApiEnvelope<ProductDto>

    @DELETE("v1/products/{product}")
    suspend fun deleteProduct(
        @Path("product") id: Long,
        @Header("Idempotency-Key") key: String,
    ): Response<Unit>

    @GET("v1/sales")
    suspend fun sales(
        @Query("q") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<SoldProductDto>

    @GET("v1/cashier/products")
    suspend fun cashierProducts(@Query("q") query: String? = null): CashierSearchResponseDto

    @POST("v1/cashier/checkout")
    suspend fun cashierCheckout(
        @Header("Idempotency-Key") key: String,
        @Body body: CashierCheckoutInputDto,
    ): ApiEnvelope<CashierCheckoutResponseDto>

    @GET("v1/notifications")
    suspend fun notifications(
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<NotificationDto>

    @POST("v1/notifications/{notification}/read")
    suspend fun markNotificationRead(@Path("notification") id: Long): Response<Unit>

    @POST("v1/notifications/read-all")
    suspend fun markAllNotificationsRead(): Response<Unit>

    @GET("v1/maintenance")
    suspend fun maintenance(
        @Query("q") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<MaintenanceDto>

    @POST("v1/maintenance")
    suspend fun createMaintenance(
        @Header("Idempotency-Key") key: String,
        @Body body: MaintenanceInputDto,
    ): ApiEnvelope<MaintenanceDto>

    @PUT("v1/maintenance/{maintenance}")
    suspend fun updateMaintenance(
        @Path("maintenance") id: Long,
        @Body body: MaintenanceInputDto,
    ): ApiEnvelope<MaintenanceDto>

    @DELETE("v1/maintenance/{maintenance}")
    suspend fun deleteMaintenance(@Path("maintenance") id: Long): Response<Unit>

    @GET("v1/wallet-cashier")
    suspend fun walletCashier(): ApiEnvelope<WalletCashierDto>

    @POST("v1/wallet-cashier")
    suspend fun createWalletTransaction(
        @Header("Idempotency-Key") key: String,
        @Body body: WalletCashierInputDto,
    ): ApiEnvelope<WalletLedgerActionDto>

    @POST("v1/wallet-cashier/{transaction}/settle")
    suspend fun settleWalletTransaction(
        @Path("transaction") uuid: String,
        @Header("Idempotency-Key") key: String,
        @Body body: SettleWalletTransactionInputDto,
    ): ApiEnvelope<WalletLedgerActionDto>

    @POST("v1/wallet-cashier/{transaction}/reverse")
    suspend fun reverseWalletTransaction(
        @Path("transaction") uuid: String,
        @Header("Idempotency-Key") key: String,
        @Body body: ReverseWalletTransactionInputDto,
    ): ApiEnvelope<WalletLedgerActionDto>

    @GET("v1/products/{product}")
    suspend fun product(@Path("product") id: Long): ApiEnvelope<ProductDto>

    @GET("v1/categories")
    suspend fun categories(
        @Query("q") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 100,
    ): ApiPage<CategoryDto>

    @GET("v1/categories/{category}")
    suspend fun category(@Path("category") id: Long): ApiEnvelope<CategoryDto>

    @GET("v1/customers")
    suspend fun customers(
        @Query("q") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<CustomerDto>

    @GET("v1/customers/{customer}")
    suspend fun customer(@Path("customer") id: Long): ApiEnvelope<CustomerDto>

    @GET("v1/suppliers")
    suspend fun suppliers(
        @Query("q") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<SupplierDto>

    @POST("v1/suppliers")
    suspend fun createSupplier(
        @Header("Idempotency-Key") key: String,
        @Body body: SupplierInputDto,
    ): ApiEnvelope<SupplierDto>

    @PUT("v1/suppliers/{supplier}")
    suspend fun updateSupplier(
        @Path("supplier") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: SupplierInputDto,
    ): ApiEnvelope<SupplierDto>

    @DELETE("v1/suppliers/{supplier}")
    suspend fun deleteSupplier(@Path("supplier") id: Long, @Header("Idempotency-Key") key: String): Response<Unit>

    @GET("v1/suppliers/{supplier}")
    suspend fun supplier(@Path("supplier") id: Long): ApiEnvelope<SupplierDto>

    @GET("v1/installments")
    suspend fun installments(
        @Query("q") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<InstallmentDto>

    @POST("v1/installments")
    suspend fun createInstallment(
        @Header("Idempotency-Key") key: String,
        @Body body: InstallmentInputDto,
    ): ApiEnvelope<InstallmentDto>

    @PUT("v1/installments/{installment}")
    suspend fun updateInstallment(
        @Path("installment") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: InstallmentInputDto,
    ): ApiEnvelope<InstallmentDto>

    @DELETE("v1/installments/{installment}")
    suspend fun deleteInstallment(
        @Path("installment") id: Long,
        @Header("Idempotency-Key") key: String,
    ): Response<Unit>

    @POST("v1/installments/{installment}/pay")
    suspend fun payInstallment(
        @Path("installment") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: PayAmountInputDto,
    ): ApiEnvelope<InstallmentDto>

    @POST("v1/installments/{installment}/status")
    suspend fun changeInstallmentStatus(
        @Path("installment") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: InstallmentStatusInputDto,
    ): ApiEnvelope<InstallmentDto>

    @GET("v1/personal-debts")
    suspend fun personalDebts(
        @Query("q") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<PersonalDebtDto>

    @POST("v1/personal-debts")
    suspend fun createPersonalDebt(
        @Header("Idempotency-Key") key: String,
        @Body body: PersonalDebtInputDto,
    ): ApiEnvelope<PersonalDebtDto>

    @PUT("v1/personal-debts/{debt}")
    suspend fun updatePersonalDebt(
        @Path("debt") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: PersonalDebtInputDto,
    ): ApiEnvelope<PersonalDebtDto>

    @POST("v1/personal-debts/{debt}/pay")
    suspend fun payPersonalDebt(
        @Path("debt") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: PayAmountInputDto,
    ): ApiEnvelope<PersonalDebtDto>

    @DELETE("v1/personal-debts/{debt}")
    suspend fun deletePersonalDebt(
        @Path("debt") id: Long,
        @Header("Idempotency-Key") key: String,
    ): Response<Unit>

    @GET("v1/installments/{installment}")
    suspend fun installment(@Path("installment") id: Long): ApiEnvelope<InstallmentDto>

    @GET("v1/invoices")
    suspend fun invoices(
        @Query("q") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<InvoiceDto>

    @GET("v1/invoices/{invoice}")
    suspend fun invoice(@Path("invoice") id: Long): ApiEnvelope<InvoiceDto>

    @Streaming
    @GET("v1/invoices/{invoice}/pdf")
    suspend fun invoicePdf(@Path("invoice") id: Long): ResponseBody

    @PUT("v1/invoices/{invoice}")
    suspend fun updateInvoice(
        @Path("invoice") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: InvoiceInputDto,
    ): ApiEnvelope<InvoiceDto>

    @POST("v1/invoices/{invoice}/pay")
    suspend fun payInvoice(
        @Path("invoice") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: PayAmountInputDto,
    ): ApiEnvelope<InvoiceDto>

    @GET("v1/wallets")
    suspend fun wallets(): ApiEnvelope<WalletOverviewDto>

    @POST("v1/wallets")
    suspend fun createWallet(
        @Header("Idempotency-Key") key: String,
        @Body body: WalletInputDto,
    ): ApiEnvelope<WalletActionDto>

    @POST("v1/wallets/{wallet}/toggle")
    suspend fun toggleWallet(
        @Path("wallet") id: Long,
        @Header("Idempotency-Key") key: String,
    ): ApiEnvelope<WalletActionDto>

    @POST("v1/wallets/{wallet}/adjust")
    suspend fun adjustWallet(
        @Path("wallet") id: Long,
        @Header("Idempotency-Key") key: String,
        @Body body: WalletAdjustmentInputDto,
    ): ApiEnvelope<WalletActionDto>

    @POST("v1/customers")
    suspend fun createCustomer(
        @Header("Idempotency-Key") key: String,
        @Body body: CustomerInputDto,
    ): ApiEnvelope<CustomerDto>

    @PUT("v1/customers/{id}")
    suspend fun updateCustomer(
        @Path("id") id: Long,
        @Body body: CustomerInputDto,
    ): ApiEnvelope<CustomerDto>

    @DELETE("v1/customers/{id}")
    suspend fun deleteCustomer(@Path("id") id: Long): Response<Unit>

    @POST("v1/categories")
    suspend fun createCategory(
        @Header("Idempotency-Key") key: String,
        @Body body: CategoryInputDto,
    ): ApiEnvelope<CategoryDto>

    @PUT("v1/categories/{id}")
    suspend fun updateCategory(
        @Path("id") id: Long,
        @Body body: CategoryInputDto,
    ): ApiEnvelope<CategoryDto>

    @DELETE("v1/categories/{id}")
    suspend fun deleteCategory(@Path("id") id: Long): Response<Unit>

    @POST("v1/invoices")
    suspend fun createInvoice(
        @Header("Idempotency-Key") key: String,
        @Body body: InvoiceInputDto,
    ): ApiEnvelope<InvoiceDto>
}
