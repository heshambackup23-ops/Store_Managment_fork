package com.storemanagement.mobile.data

import com.storemanagement.mobile.core.database.CatalogDatabase
import com.storemanagement.mobile.core.network.ApiCallExecutor
import com.storemanagement.mobile.core.network.ApiFailure
import com.storemanagement.mobile.core.network.ApiResult
import com.storemanagement.mobile.core.network.LoginRequestDto
import com.storemanagement.mobile.core.network.StoreApi
import com.storemanagement.mobile.core.network.UserDto
import com.storemanagement.mobile.core.security.SecureTokenStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SessionRepository @Inject constructor(
    private val api: StoreApi,
    private val calls: ApiCallExecutor,
    private val tokenStore: SecureTokenStore,
    private val database: CatalogDatabase,
) {
    suspend fun hasStoredToken(): Boolean = withContext(Dispatchers.IO) {
        !tokenStore.readToken().isNullOrBlank()
    }

    suspend fun login(username: String, password: String, deviceName: String): ApiResult<UserDto> {
        val result = calls.execute {
            api.issueToken(LoginRequestDto(username, password, deviceName))
        }

        return when (result) {
            is ApiResult.Success -> {
                clearCachedAccountData()
                withContext(Dispatchers.IO) {
                    tokenStore.saveToken(result.value.data.accessToken)
                }
                ApiResult.Success(result.value.data.user)
            }
            // A 401 while signing in means wrong credentials, not an expired session.
            is ApiResult.Failure -> if (result.error == ApiFailure.Unauthorized) {
                ApiResult.Failure(ApiFailure.InvalidCredentials)
            } else {
                result
            }
        }
    }

    suspend fun restore(): ApiResult<UserDto?> {
        if (!hasStoredToken()) return ApiResult.Success(null)

        return when (val result = calls.execute { api.currentUser().data }) {
            is ApiResult.Success -> ApiResult.Success(result.value)
            is ApiResult.Failure -> {
                if (result.error == ApiFailure.Unauthorized) {
                    clearLocalSession()
                    ApiResult.Success(null)
                } else {
                    result
                }
            }
        }
    }

    suspend fun logout(): ApiResult<Unit> {
        val result = if (!hasStoredToken()) {
            ApiResult.Success(Unit)
        } else {
            calls.execute {
                val response = api.revokeCurrentToken()
                if (!response.isSuccessful) throw HttpException(response)
            }
        }

        clearLocalSession()
        return result
    }

    suspend fun clearLocalSession() {
        withContext(Dispatchers.IO) {
            tokenStore.clear()
        }
        clearCachedAccountData()
    }

    private suspend fun clearCachedAccountData() {
        database.catalogDao().clearProducts()
        database.catalogDao().clearCategories()
    }
}
