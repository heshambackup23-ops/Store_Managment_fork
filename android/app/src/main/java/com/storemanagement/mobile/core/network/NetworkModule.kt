package com.storemanagement.mobile.core.network

import com.storemanagement.mobile.BuildConfig
import com.storemanagement.mobile.core.security.SecureTokenStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Interceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        // Older web-created records may carry numbers where the app expects text.
        isLenient = true
        coerceInputValues = true
    }

    @Provides
    @Singleton
    fun provideAuthInterceptor(tokenStore: SecureTokenStore): Interceptor = Interceptor { chain ->
        val request = chain.request()
        val token = tokenStore.readToken()
        val authorizedRequest = if (token.isNullOrBlank()) {
            request
        } else {
            request.newBuilder().header("Authorization", "Bearer $token").build()
        }
        chain.proceed(authorizedRequest)
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(authInterceptor: Interceptor, connectionMonitor: ConnectionMonitor): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(authInterceptor)
        .addInterceptor(connectionMonitor.interceptor)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()

    @Provides
    @Singleton
    fun provideStoreApi(client: OkHttpClient, json: Json): StoreApi {
        require(BuildConfig.API_BASE_URL.startsWith("https://") || BuildConfig.DEBUG) {
            "Non-debug builds must use an HTTPS API base URL."
        }

        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(StoreApi::class.java)
    }
}
