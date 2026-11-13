package com.storemanagement.mobile

import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StagingAcceptanceTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun launchesPublishedStagingAndReachesCloudApi() {
        assertEquals("https://henra-store-demo-ui.pages.dev/api/", BuildConfig.API_BASE_URL)
        waitForText("سجّل الدخول للمتابعة")
        val request = Request.Builder()
            .url(BuildConfig.API_BASE_URL + "v1/me")
            .header("X-Store-Client", "android")
            .build()
        OkHttpClient().newCall(request).execute().use { response ->
            assertEquals(401, response.code)
            val payload = JSONObject(requireNotNull(response.body).string())
            assertEquals("unauthorized", payload.getString("code"))
        }
    }

    @Test
    fun signsInReadsAndCreatesProductAndSignsOutAgainstIsolatedWorker() {
        assertEquals("http://127.0.0.1:8787/api/", BuildConfig.API_BASE_URL)
        waitForText("سجّل الدخول للمتابعة")
        compose.onNodeWithText("اسم المستخدم").performTextReplacement("emulator-operator")
        compose.onNodeWithText("كلمة المرور").performTextReplacement("hilal-emulator-fixture-only")
        compose.onNodeWithText("دخول").performScrollTo().performClick()
        waitForText("مسؤول محاكي هلال")

        compose.onAllNodes(hasText("المنتجات") and hasClickAction())[0].performClick()
        waitForText("دفتر ملاحظات")
        compose.onNodeWithContentDescription("إضافة منتج").performClick()
        compose.onNodeWithText("اسم المنتج").performScrollTo().performTextReplacement("منتج من محاكي هلال")
        compose.onNodeWithText("السعر").performScrollTo().performTextReplacement("13.25")
        compose.onNodeWithText("حفظ المنتج").performClick()
        waitForText("منتج من محاكي هلال")

        compose.onNodeWithContentDescription("تسجيل الخروج").performClick()
        waitForText("سجّل الدخول للمتابعة")
    }

    private fun waitForText(text: String) {
        compose.waitUntil(timeoutMillis = 30_000) {
            compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
        }
    }
}
