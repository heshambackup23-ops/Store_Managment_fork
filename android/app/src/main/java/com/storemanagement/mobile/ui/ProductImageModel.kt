package com.storemanagement.mobile.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.storemanagement.mobile.core.network.StoreApi
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@EntryPoint
@InstallIn(SingletonComponent::class)
interface ProductImageEntryPoint {
    fun storeApi(): StoreApi
}

private val hilalProductImagePath = Regex("^/api/v1/products/([0-9]+)/image$")

@Composable
internal fun productImageModel(url: String?, revision: Any? = null): Any? {
    val id = url?.let { hilalProductImagePath.matchEntire(it) }?.groupValues?.get(1)?.toLongOrNull()
    if (id == null) return url
    val app = LocalContext.current.applicationContext
    val api = remember(app) {
        EntryPointAccessors.fromApplication(app, ProductImageEntryPoint::class.java).storeApi()
    }
    val bytes by produceState<ByteArray?>(null, id, revision) {
        value = null
        value = try {
            withContext(Dispatchers.IO) { api.productImage(id).use { it.bytes() } }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            null
        }
    }
    return bytes
}
