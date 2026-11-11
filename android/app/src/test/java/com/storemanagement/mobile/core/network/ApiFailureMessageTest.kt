package com.storemanagement.mobile.core.network

import org.junit.Assert.assertEquals
import org.junit.Test

class ApiFailureMessageTest {
    @Test
    fun validationShowsArabicServerMessages() {
        val failure = ApiFailure.Validation(
            mapOf("quantity" to listOf("الزيادة أكبر من المخزون المتاح (3)."), "name" to listOf("The name is required.")),
        )
        assertEquals("الزيادة أكبر من المخزون المتاح (3).", failure.message)
    }

    @Test
    fun validationFallsBackWhenServerMessagesAreNotArabic() {
        val failure = ApiFailure.Validation(mapOf("name" to listOf("The name is required.")))
        assertEquals("راجع البيانات المدخلة ثم حاول مرة أخرى.", failure.message)
    }

    @Test
    fun validationFallsBackWhenThereAreNoMessages() {
        assertEquals("راجع البيانات المدخلة ثم حاول مرة أخرى.", ApiFailure.Validation(emptyMap()).message)
    }
}
