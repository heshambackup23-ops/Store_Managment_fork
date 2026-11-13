package com.storemanagement.mobile.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.storemanagement.mobile.core.network.ApiCallExecutor
import com.storemanagement.mobile.core.network.ApiFailure
import com.storemanagement.mobile.core.network.ApiPage
import com.storemanagement.mobile.core.network.ApiResult
import com.storemanagement.mobile.core.network.ApproveRetailShiftDto
import com.storemanagement.mobile.core.network.CloseRetailShiftDto
import com.storemanagement.mobile.core.network.CustomerDto
import com.storemanagement.mobile.core.network.OpenRetailShiftDto
import com.storemanagement.mobile.core.network.RetailCashMovementDto
import com.storemanagement.mobile.core.network.RetailDeviceDto
import com.storemanagement.mobile.core.network.RetailCheckoutDto
import com.storemanagement.mobile.core.network.RetailCheckoutReceiptDto
import com.storemanagement.mobile.core.network.RetailShiftDto
import com.storemanagement.mobile.core.network.StoreApi
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

internal data class RetailDetail<T>(
    val record: T? = null,
    val isLoading: Boolean = false,
    val error: String? = null,
)

internal data class RetailMutation(
    val isSaving: Boolean = false,
    val error: String? = null,
    val completedKey: String? = null,
)

internal data class RetailCheckoutContext(
    val requiresShift: Boolean = true,
    val ownedShift: RetailShiftDto? = null,
)

@HiltViewModel
internal class RetailViewModel @Inject constructor(
    private val api: StoreApi,
    private val calls: ApiCallExecutor,
) : ViewModel() {
    private val shiftState = MutableStateFlow(RemotePage<RetailShiftDto>())
    private val deviceState = MutableStateFlow(RemotePage<RetailDeviceDto>())
    private val movementState = MutableStateFlow(RemotePage<RetailCashMovementDto>())
    private val shiftDetailState = MutableStateFlow(RetailDetail<RetailShiftDto>())
    private val deviceDetailState = MutableStateFlow(RetailDetail<RetailDeviceDto>())
    private val mutationState = MutableStateFlow(RetailMutation())
    private val expiredState = MutableStateFlow(false)
    private val checkoutContextState = MutableStateFlow(RetailDetail<RetailCheckoutContext>())
    private val checkoutDevicesState = MutableStateFlow(RemotePage<RetailDeviceDto>())
    private val checkoutCustomersState = MutableStateFlow(RemotePage<CustomerDto>())
    private val checkoutMutationState = MutableStateFlow(RetailMutation())
    private val myShiftState = MutableStateFlow(RetailDetail<RetailShiftDto>(isLoading = true))
    val shifts = shiftState.asStateFlow()
    val devices = deviceState.asStateFlow()
    val cashMovements = movementState.asStateFlow()
    val shift = shiftDetailState.asStateFlow()
    val device = deviceDetailState.asStateFlow()
    val mutation = mutationState.asStateFlow()
    val expired = expiredState.asStateFlow()
    val checkoutContext = checkoutContextState.asStateFlow()
    val checkoutDevices = checkoutDevicesState.asStateFlow()
    val checkoutCustomers = checkoutCustomersState.asStateFlow()
    val checkoutMutation = checkoutMutationState.asStateFlow()
    val myShift = myShiftState.asStateFlow()

    private var shiftListJob: Job? = null
    private var deviceListJob: Job? = null
    private var movementJob: Job? = null
    private var shiftDetailJob: Job? = null
    private var deviceDetailJob: Job? = null
    private var writeJob: Job? = null
    private var checkoutContextJob: Job? = null
    private var checkoutDevicesJob: Job? = null
    private var checkoutCustomersJob: Job? = null
    private var checkoutWriteJob: Job? = null
    private var myShiftJob: Job? = null
    private var shiftStatus: String? = null
    private var ownerId: Long? = null

    fun useSession(userId: Long) {
        if (ownerId == userId && !expiredState.value) return
        ownerId = userId
        listOf(
            shiftListJob, deviceListJob, movementJob, shiftDetailJob, deviceDetailJob, writeJob,
            checkoutContextJob, checkoutDevicesJob, checkoutCustomersJob, checkoutWriteJob, myShiftJob,
        ).forEach { it?.cancel() }
        shiftState.value = RemotePage()
        deviceState.value = RemotePage()
        movementState.value = RemotePage()
        shiftDetailState.value = RetailDetail()
        deviceDetailState.value = RetailDetail()
        mutationState.value = RetailMutation()
        expiredState.value = false
        checkoutContextState.value = RetailDetail()
        checkoutDevicesState.value = RemotePage()
        checkoutCustomersState.value = RemotePage()
        checkoutMutationState.value = RetailMutation()
        myShiftState.value = RetailDetail(isLoading = true)
    }

    fun loadMyShift(userId: Long) {
        myShiftJob?.cancel()
        myShiftState.value = RetailDetail(isLoading = true)
        myShiftJob = viewModelScope.launch {
            myShiftState.value = when (val result = calls.execute { findMyShift(userId) }) {
                is ApiResult.Success -> RetailDetail(record = result.value)
                is ApiResult.Failure -> RetailDetail(error = errorMessage(result.error))
            }
        }
    }

    private suspend fun findMyShift(userId: Long): RetailShiftDto? {
        var page = 1
        while (page <= 10_000) {
            val response = api.retailShifts("open", page, 100)
            val shift = response.data.firstOrNull { it.actorId == userId }
            if (shift != null) return shift
            if (page >= (response.meta?.lastPage ?: 1)) return null
            page += 1
        }
        return null
    }

    fun loadCheckoutContext(userId: Long, canOperate: Boolean) {
        checkoutContextJob?.cancel()
        checkoutContextJob = loadDetail(checkoutContextState) {
            val required = api.retailSettings().data.requireShift
            val ownedShift = if (canOperate) findMyShift(userId) else null
            RetailCheckoutContext(required, ownedShift)
        }
    }

    fun loadCheckoutDevices(productId: Long, query: String?, page: Int = 1) {
        checkoutDevicesJob?.cancel()
        checkoutDevicesJob = loadPage(checkoutDevicesState, page) { api.retailDevices(query, "available", page, productId) }
    }

    fun loadCheckoutCustomers(query: String?, page: Int = 1) {
        checkoutCustomersJob?.cancel()
        checkoutCustomersJob = loadPage(checkoutCustomersState, page) { api.customers(query, page) }
    }

    fun clearCheckoutMutation() {
        if (!checkoutMutationState.value.isSaving) checkoutMutationState.value = RetailMutation()
    }

    fun checkout(key: String, input: RetailCheckoutDto, onComplete: (RetailCheckoutReceiptDto) -> Unit) {
        if (checkoutWriteJob?.isActive == true) return
        checkoutMutationState.value = RetailMutation(isSaving = true)
        checkoutWriteJob = viewModelScope.launch {
            when (val result = calls.execute { api.retailCheckout(key, input).data }) {
                is ApiResult.Success -> {
                    checkoutMutationState.value = RetailMutation(completedKey = key)
                    onComplete(result.value)
                }
                is ApiResult.Failure -> checkoutMutationState.value = RetailMutation(error = errorMessage(result.error))
            }
        }
    }

    fun loadShifts(status: String?, page: Int = 1) {
        shiftStatus = status
        shiftListJob?.cancel()
        shiftListJob = loadPage(shiftState, page) { api.retailShifts(status, page) }
    }

    fun loadDevices(query: String?, status: String?, page: Int = 1) {
        deviceListJob?.cancel()
        deviceListJob = loadPage(deviceState, page) { api.retailDevices(query, status, page) }
    }

    fun loadMovements(shiftId: Long, page: Int = 1) {
        movementJob?.cancel()
        movementJob = loadPage(movementState, page) { api.retailCashMovements(shiftId, page) }
    }

    fun loadShift(id: Long) {
        shiftDetailJob?.cancel()
        shiftDetailJob = loadDetail(shiftDetailState) { api.retailShift(id).data }
    }

    fun loadDevice(id: Long) {
        deviceDetailJob?.cancel()
        deviceDetailJob = loadDetail(deviceDetailState) { api.retailDevice(id).data }
    }

    fun openShift(key: String, input: OpenRetailShiftDto) = writeShift(key) { api.openRetailShift(key, input).data }

    fun closeShift(id: Long, key: String, input: CloseRetailShiftDto) =
        writeShift(key) { api.closeRetailShift(id, key, input).data }

    fun approveShift(id: Long, key: String, input: ApproveRetailShiftDto) =
        writeShift(key) { api.approveRetailShift(id, key, input).data }

    fun clearMutation() {
        if (!mutationState.value.isSaving) mutationState.value = RetailMutation()
    }

    private fun writeShift(key: String, write: suspend () -> RetailShiftDto) {
        if (writeJob?.isActive == true) return
        mutationState.value = RetailMutation(isSaving = true)
        writeJob = viewModelScope.launch {
            when (val result = calls.execute(write)) {
                is ApiResult.Success -> {
                    shiftDetailJob?.cancel()
                    shiftDetailState.value = RetailDetail(record = result.value)
                    mutationState.value = RetailMutation(completedKey = key)
                    loadShifts(shiftStatus)
                }
                is ApiResult.Failure -> mutationState.value = RetailMutation(error = errorMessage(result.error))
            }
        }
    }

    private fun <T> loadDetail(state: MutableStateFlow<RetailDetail<T>>, fetch: suspend () -> T): Job {
        state.value = RetailDetail(isLoading = true)
        return viewModelScope.launch {
            state.value = when (val result = calls.execute(fetch)) {
                is ApiResult.Success -> RetailDetail(record = result.value)
                is ApiResult.Failure -> RetailDetail(error = errorMessage(result.error))
            }
        }
    }

    private fun <T> loadPage(
        state: MutableStateFlow<RemotePage<T>>,
        page: Int,
        fetch: suspend () -> ApiPage<T>,
    ): Job {
        val previous: RemotePage<T> = if (page == 1) RemotePage() else state.value
        state.value = previous.copy(isLoading = true, error = null)
        return viewModelScope.launch {
            state.value = when (val result = calls.execute(fetch)) {
                is ApiResult.Success -> RemotePage(
                    items = previous.items + result.value.data,
                    currentPage = result.value.meta?.currentPage ?: page,
                    lastPage = result.value.meta?.lastPage ?: page,
                    total = result.value.meta?.total ?: result.value.data.size,
                )
                is ApiResult.Failure -> previous.copy(isLoading = false, error = errorMessage(result.error))
            }
        }
    }

    private fun errorMessage(failure: ApiFailure): String {
        if (failure == ApiFailure.Unauthorized) expiredState.value = true
        return failure.message
    }
}
