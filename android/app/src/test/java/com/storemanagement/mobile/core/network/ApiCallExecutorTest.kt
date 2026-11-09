package com.storemanagement.mobile.core.network

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class ApiCallExecutorTest {
    private val executor = ApiCallExecutor(Json { ignoreUnknownKeys = true })

    @Test
    fun validationResponsesRetainFieldErrorsAndStableCode() = runBlocking {
        val result = executor.execute<String> {
            throw HttpException(
                Response.error<String>(
                    422,
                    """{"error_code":"VALIDATION_FAILED","errors":{"name":["The name is required."]}}"""
                        .toResponseBody("application/json".toMediaType()),
                ),
            )
        }

        assertTrue(result is ApiResult.Failure)
        val failure = (result as ApiResult.Failure).error
        assertTrue(failure is ApiFailure.Validation)
        assertEquals(listOf("The name is required."), (failure as ApiFailure.Validation).fields["name"])
    }

    @Test
    fun unauthorizedResponsesUseTheSessionExpiredFailure() = runBlocking {
        val result = executor.execute<String> {
            throw HttpException(
                Response.error<String>(
                    401,
                    """{"error_code":"AUTHENTICATION_REQUIRED"}"""
                        .toResponseBody("application/json".toMediaType()),
                ),
            )
        }

        assertTrue(result is ApiResult.Failure)
        assertEquals(ApiFailure.Unauthorized, (result as ApiResult.Failure).error)
    }

    @Test
    fun cancellationIsRethrownWithoutErrorMapping() = runBlocking {
        val cancellation = CancellationException("request cancelled")

        try {
            executor.execute<String> { throw cancellation }
            throw AssertionError("Expected the cancellation to be rethrown")
        } catch (actual: CancellationException) {
            assertSame(cancellation, actual)
        }
    }
}
