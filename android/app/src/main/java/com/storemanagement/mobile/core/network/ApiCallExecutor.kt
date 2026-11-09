package com.storemanagement.mobile.core.network

import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.inject.Inject
import javax.net.ssl.SSLException
import kotlinx.serialization.SerializationException

@Serializable
private data class ErrorEnvelope(
    @SerialName("error_code") val errorCode: String? = null,
    val errors: Map<String, List<String>> = emptyMap(),
)

class ApiCallExecutor @Inject constructor(
    private val json: Json,
) {
    suspend fun <T> execute(call: suspend () -> T): ApiResult<T> = try {
        ApiResult.Success(call())
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (failure: Exception) {
        ApiResult.Failure(mapFailure(failure))
    }

    private fun mapFailure(failure: Throwable): ApiFailure = when (failure) {
        is HttpException -> mapHttpFailure(failure)
        is UnknownHostException -> ApiFailure.NoConnection
        is SocketTimeoutException -> ApiFailure.Timeout
        is SSLException -> ApiFailure.SecureConnection
        is ConnectException -> ApiFailure.NoConnection
        is SerializationException -> ApiFailure.MalformedResponse
        is IOException -> ApiFailure.ConnectionLost
        else -> ApiFailure.Unknown
    }

    private fun mapHttpFailure(failure: HttpException): ApiFailure {
        val envelope = runCatching {
            failure.response()?.errorBody()?.string()?.let { json.decodeFromString<ErrorEnvelope>(it) }
        }.getOrNull()

        return when (failure.code()) {
            401 -> ApiFailure.Unauthorized
            403 -> ApiFailure.Forbidden
            404 -> ApiFailure.NotFound
            409 -> ApiFailure.Conflict(envelope?.errorCode)
            422 -> ApiFailure.Validation(envelope?.errors.orEmpty())
            429 -> ApiFailure.RateLimited
            in 500..599 -> ApiFailure.Server
            else -> ApiFailure.Unknown
        }
    }
}
