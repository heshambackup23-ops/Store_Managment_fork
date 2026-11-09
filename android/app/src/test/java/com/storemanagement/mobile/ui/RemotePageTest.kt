package com.storemanagement.mobile.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class RemotePageTest {
    @Test
    fun appendPageKeepsExistingRowsAndUpdatesPageMetadata() {
        val firstPage = RemotePage(
            items = listOf(Entry(1, "First"), Entry(2, "Second")),
            currentPage = 1,
            lastPage = 3,
            total = 5,
        )
        val nextPage = RemotePage(
            items = listOf(Entry(2, "Duplicate"), Entry(3, "Third")),
            currentPage = 2,
            lastPage = 3,
            total = 5,
        )

        val merged = firstPage.appendPage(nextPage, Entry::id)

        assertEquals(listOf(1L, 2L, 3L), merged.items.map(Entry::id))
        assertEquals("Second", merged.items[1].name)
        assertEquals(2, merged.currentPage)
        assertEquals(3, merged.lastPage)
        assertEquals(5, merged.total)
    }

    private data class Entry(val id: Long, val name: String)
}
