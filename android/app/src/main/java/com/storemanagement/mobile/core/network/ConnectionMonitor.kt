package com.storemanagement.mobile.core.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.SystemClock
import com.storemanagement.mobile.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

enum class ConnectionStatus { Checking, Online, ServerUnreachable, Offline }

data class ConnectionState(
    val status: ConnectionStatus = ConnectionStatus.Checking,
    val latencyMillis: Long? = null,
)

/** Pure rule used by the monitor (and unit-tested): the device network wins over the server probe. */
internal fun resolveConnectionStatus(deviceOnline: Boolean, serverReachable: Boolean?): ConnectionStatus = when {
    !deviceOnline -> ConnectionStatus.Offline
    serverReachable == null -> ConnectionStatus.Checking
    serverReachable -> ConnectionStatus.Online
    else -> ConnectionStatus.ServerUnreachable
}

/**
 * Tracks two things: whether the phone has a network, and whether the Store server really answers.
 * The server is probed through Laravel's `/up` health route, and every real API call also reports
 * its outcome here through [interceptor], so the indicator reacts immediately to failures.
 */
@Singleton
class ConnectionMonitor @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private val pingClient = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(4, TimeUnit.SECONDS)
        .callTimeout(6, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build()
    private val healthUrl: HttpUrl? = BuildConfig.API_BASE_URL.toHttpUrlOrNull()
        ?.newBuilder()
        ?.encodedPath("/up")
        ?.query(null)
        ?.build()

    @Volatile private var deviceOnline: Boolean = readDeviceOnline()
    @Volatile private var serverReachable: Boolean? = null
    @Volatile private var latencyMillis: Long? = null
    private var loop: Job? = null
    private var callbackRegistered = false

    private val mutableState = MutableStateFlow(
        ConnectionState(resolveConnectionStatus(deviceOnline, serverReachable)),
    )
    val state: StateFlow<ConnectionState> = mutableState.asStateFlow()

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            deviceOnline = true
            publish()
            checkNow()
        }

        override fun onLost(network: Network) {
            deviceOnline = readDeviceOnline()
            if (!deviceOnline) serverReachable = null
            publish()
        }
    }

    /** Reports the outcome of every real API call made through OkHttp. */
    val interceptor: Interceptor = Interceptor { chain ->
        try {
            val response = chain.proceed(chain.request())
            report(reachable = true)
            response
        } catch (failure: IOException) {
            // A request the app cancelled itself (e.g. a superseded search) says nothing about the server.
            if (!chain.call().isCanceled()) report(reachable = false)
            throw failure
        }
    }

    fun start() {
        deviceOnline = readDeviceOnline()
        publish()
        registerCallback()
        if (loop?.isActive == true) return
        loop = scope.launch {
            while (isActive) {
                probe()
                delay(if (serverReachable == true) HEALTHY_INTERVAL_MS else RECOVERY_INTERVAL_MS)
            }
        }
    }

    fun stop() {
        loop?.cancel()
        loop = null
        unregisterCallback()
    }

    fun checkNow() {
        scope.launch { probe() }
    }

    private fun report(reachable: Boolean) {
        serverReachable = reachable
        publish()
    }

    private fun publish() {
        mutableState.value = ConnectionState(
            status = resolveConnectionStatus(deviceOnline, serverReachable),
            latencyMillis = latencyMillis.takeIf { serverReachable == true },
        )
    }

    private suspend fun probe() {
        deviceOnline = readDeviceOnline()
        if (!deviceOnline) {
            serverReachable = null
            publish()
            return
        }
        val url = healthUrl ?: return
        var reachable = false
        var elapsed = 0L
        // One slow or dropped packet should not flip the indicator, so try twice before reporting a problem.
        for (attempt in 1..2) {
            val started = SystemClock.elapsedRealtime()
            reachable = try {
                pingClient.newCall(Request.Builder().url(url).get().build()).execute().use { true }
            } catch (failure: IOException) {
                false
            }
            elapsed = SystemClock.elapsedRealtime() - started
            if (reachable) break
            if (attempt == 1) delay(1_500)
        }
        latencyMillis = if (reachable) elapsed else null
        serverReachable = reachable
        publish()
    }

    private fun readDeviceOnline(): Boolean {
        val manager = connectivity ?: return true
        val network = manager.activeNetwork ?: return false
        val capabilities = manager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun registerCallback() {
        if (callbackRegistered) return
        val manager = connectivity ?: return
        try {
            manager.registerDefaultNetworkCallback(callback)
            callbackRegistered = true
        } catch (_: SecurityException) {
            callbackRegistered = false
        }
    }

    private fun unregisterCallback() {
        if (!callbackRegistered) return
        try {
            connectivity?.unregisterNetworkCallback(callback)
        } catch (_: IllegalArgumentException) {
            // Already unregistered.
        }
        callbackRegistered = false
    }

    private companion object {
        const val HEALTHY_INTERVAL_MS = 30_000L
        const val RECOVERY_INTERVAL_MS = 6_000L
    }
}
