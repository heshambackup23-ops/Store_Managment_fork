package com.storemanagement.mobile.core.network

import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionStatusTest {
    @Test
    fun deviceOfflineAlwaysWins() {
        assertEquals(ConnectionStatus.Offline, resolveConnectionStatus(deviceOnline = false, serverReachable = true))
        assertEquals(ConnectionStatus.Offline, resolveConnectionStatus(deviceOnline = false, serverReachable = null))
    }

    @Test
    fun unknownServerStateIsChecking() {
        assertEquals(ConnectionStatus.Checking, resolveConnectionStatus(deviceOnline = true, serverReachable = null))
    }

    @Test
    fun reachableAndUnreachableServer() {
        assertEquals(ConnectionStatus.Online, resolveConnectionStatus(deviceOnline = true, serverReachable = true))
        assertEquals(ConnectionStatus.ServerUnreachable, resolveConnectionStatus(deviceOnline = true, serverReachable = false))
    }
}
