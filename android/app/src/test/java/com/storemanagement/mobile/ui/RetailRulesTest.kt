package com.storemanagement.mobile.ui

import com.storemanagement.mobile.core.network.RetailShiftDto
import com.storemanagement.mobile.core.network.UserDto
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RetailRulesTest {
    @Test
    fun parsesEgyptianCurrencyWithoutRoundingOrAcceptingOversizeValues() {
        assertEquals(7_025L, retailMinorUnits("٧٠٫٢٥"))
        assertEquals(0L, retailMinorUnits("0"))
        assertEquals(900_000_000_000_000L, retailMinorUnits("9000000000000.00"))
        assertNull(retailMinorUnits("9000000000000.01"))
        assertNull(retailMinorUnits("17.125"))
        assertNull(retailMinorUnits("-0.25"))
    }

    @Test
    fun onlyTheOwnerClosesAndAnIndependentSupervisorApproves() {
        val permission = listOf("page.retail_shifts.operate", "page.retail_shifts.approve")
        val cashier = UserDto(10, "Cashier", permissions = permission)
        val supervisor = UserDto(11, "Supervisor", permissions = permission)
        val operatorOnly = supervisor.copy(permissions = listOf("page.retail_shifts.operate"))
        val shift = RetailShiftDto(1, "Counter", cashier.id, cashier.name, "2026-11-13", "2026-11-13T07:00:00Z",
            "open", openingMinor = 50_000, expectedMinor = 51_000)
        assertTrue(shift.canClose(cashier))
        assertFalse(shift.canClose(supervisor))
        assertFalse(shift.canApprove(supervisor))
        val pending = shift.copy(status = "pending_approval", observedMinor = 50_000, differenceMinor = -1_000)
        assertFalse(pending.canClose(cashier))
        assertFalse(pending.canApprove(cashier))
        assertFalse(pending.canApprove(operatorOnly))
        assertTrue(pending.canApprove(supervisor))
    }
}
