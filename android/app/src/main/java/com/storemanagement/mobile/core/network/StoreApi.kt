package com.storemanagement.mobile.core.network

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface StoreApi {
    @POST("v1/auth/token")
    suspend fun issueToken(@Body body: LoginRequestDto): TokenResponse

    @GET("v1/me")
    suspend fun currentUser(): ApiEnvelope<UserDto>

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

    @GET("v1/suppliers/{supplier}")
    suspend fun supplier(@Path("supplier") id: Long): ApiEnvelope<SupplierDto>

    @GET("v1/installments")
    suspend fun installments(
        @Query("q") query: String? = null,
        @Query("page") page: Int = 1,
        @Query("per_page") perPage: Int = 20,
    ): ApiPage<InstallmentDto>

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
