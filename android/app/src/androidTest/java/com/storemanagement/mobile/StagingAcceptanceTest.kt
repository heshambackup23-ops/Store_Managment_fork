package com.storemanagement.mobile

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.printToString
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.storemanagement.mobile.ui.retailDeviceScreenTag
import com.storemanagement.mobile.ui.retailShiftCloseTag
import com.storemanagement.mobile.ui.retailShiftConfirmTag
import com.storemanagement.mobile.ui.retailShiftOpenTag
import com.storemanagement.mobile.ui.retailShiftScreenTag
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
    fun sellsTrackedDeviceAndClosesShiftAgainstIsolatedWorker() {
        assertEquals("http://127.0.0.1:8787/api/", BuildConfig.API_BASE_URL)
        signIn("emulator-operator", "مسؤول محاكي هلال")

        compose.onNodeWithTag("store-tab-Products").performSemanticsAction(SemanticsActions.OnClick)
        waitForText("دفتر ملاحظات")
        compose.onNodeWithContentDescription("إضافة منتج").performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("اسم المنتج").performScrollTo().performTextReplacement("منتج من محاكي هلال")
        compose.onNodeWithText("السعر").performScrollTo().performTextReplacement("13.25")
        compose.onNode(hasText("حفظ المنتج") and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
        waitFor("saved product dialog to close") {
            compose.onAllNodesWithText("حفظ المنتج").fetchSemanticsNodes().isEmpty()
        }

        openRetailMenu("retail-menu-shifts", retailShiftScreenTag)
        waitForText("لا توجد ورديات مطابقة.")
        compose.onNodeWithTag(retailShiftOpenTag).performClick()
        compose.onNodeWithText("اسم درج النقدية").performTextReplacement("درج محاكي هلال")
        compose.onNodeWithText("عهدة الفتح بالجنيه").performTextReplacement("50.00")
        compose.onNodeWithTag(retailShiftConfirmTag).performClick()
        waitForText("درج محاكي هلال")

        openMenuEntry("retail-menu-checkout")
        val phone = "هاتف محاكي هلال"
        val barcode = "HILAL-EMU-TRACKED"
        val serial = "HILAL-EMU-IMEI"
        val imei = "490154203237518"
        waitForText("اسم المنتج أو الباركود")
        compose.onNodeWithText("اسم المنتج أو الباركود").performTextReplacement(barcode)
        compose.onNodeWithContentDescription("بحث عن منتج").performSemanticsAction(SemanticsActions.OnClick)
        waitForText(phone)
        compose.onNodeWithTag("cashier-add-$barcode").performSemanticsAction(SemanticsActions.OnClick)
        clickText("إتمام البيع")
        waitForText("تحصيل الفاتورة")
        clickText("$phone · اختيار الأجهزة 0/1")
        compose.onNodeWithText("الرقم التسلسلي أو IMEI").performTextReplacement(imei)
        waitForText("$serial · $imei")
        clickText("$serial · $imei")
        clickText("اعتماد الأجهزة")
        waitForText("$phone · اختيار الأجهزة 1/1")
        waitForText("بطاقة بالجنيه")
        compose.onNodeWithText("نقدي بالجنيه").performScrollTo().performTextReplacement("30.00")
        compose.onNodeWithText("بطاقة بالجنيه").performScrollTo().performTextReplacement("20.00")
        compose.onNodeWithText("مرجع بطاقة (اختياري)").performScrollTo().performTextReplacement("EMULATOR-CARD")
        clickText("تأكيد البيع")
        waitForText("تمت عملية البيع")
        clickText("تم")

        openRetailMenu("retail-menu-shifts", retailShiftScreenTag)
        waitForText("درج محاكي هلال")
        clickText("درج محاكي هلال")
        waitFor("open shift details") { compose.onAllNodes(hasTestTag(retailShiftCloseTag)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag(retailShiftCloseTag).performScrollTo().performSemanticsAction(SemanticsActions.OnClick)
        compose.onNodeWithText("النقد الفعلي بالجنيه").performTextReplacement("79.00")
        compose.onNodeWithText("سبب الفرق (مطلوب)").performScrollTo().performTextReplacement("فرق اختبار المحاكي")
        compose.onNodeWithTag(retailShiftConfirmTag).performClick()
        waitForText("تنتظر الاعتماد")
        compose.onNodeWithText("اعتماد فرق الوردية").assertDoesNotExist()

        openRetailMenu("retail-menu-devices", retailDeviceScreenTag)
        val deviceSearch = compose.onNodeWithText("الرقم التسلسلي أو IMEI")
        deviceSearch.performTextReplacement("NO-EMULATOR-DEVICE")
        waitForText("لا توجد أجهزة مطابقة.")
        deviceSearch.performTextReplacement(imei)
        waitForText(serial)
        clickText(serial)
        waitForText("استلام المخزون")
        waitForText(imei)
        waitForText("ضمان ساري")

        signOut()
        signIn("emulator-reviewer", "مراجع محاكي هلال")
        openRetailMenu("retail-menu-shifts", retailShiftScreenTag)
        waitForText("درج محاكي هلال")
        clickText("درج محاكي هلال")
        waitForText("اعتماد فرق الوردية")
        clickText("اعتماد فرق الوردية")
        compose.onNodeWithText("سبب الاعتماد").performScrollTo().performTextReplacement("راجعت فرق اختبار المحاكي")
        compose.onNodeWithTag(retailShiftConfirmTag).performSemanticsAction(SemanticsActions.OnClick)
        waitForText("معتمدة")
        signOut()
    }

    private fun signIn(username: String, name: String) {
        waitForText("سجّل الدخول للمتابعة")
        compose.onNodeWithText("اسم المستخدم").performTextReplacement(username)
        compose.onNodeWithText("كلمة المرور").performTextReplacement("hilal-emulator-fixture-only")
        compose.onNodeWithText("دخول").performScrollTo().performClick()
        waitForText(name)
    }

    private fun signOut() {
        compose.onNodeWithContentDescription("تسجيل الخروج").performSemanticsAction(SemanticsActions.OnClick)
        waitForText("سجّل الدخول للمتابعة")
    }

    private fun clickText(text: String) {
        compose.onNode(hasText(text) and hasClickAction()).performSemanticsAction(SemanticsActions.OnClick)
    }

    private fun openRetailMenu(menu: String, screen: String) {
        openMenuEntry(menu)
        waitFor("screen '$screen'") { compose.onAllNodes(hasTestTag(screen)).fetchSemanticsNodes().isNotEmpty() }
    }

    private fun openMenuEntry(menu: String) {
        compose.onNodeWithTag("store-tab-More").performSemanticsAction(SemanticsActions.OnClick)
        val entry = compose.onNodeWithTag(menu).performScrollTo()
        entry.performSemanticsAction(SemanticsActions.OnClick)
    }

    private fun waitForText(text: String) = waitFor("visible text '$text'") {
        compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    private fun waitFor(description: String, predicate: () -> Boolean) {
        try {
            compose.waitUntil(timeoutMillis = 30_000, condition = predicate)
        } catch (failure: Throwable) {
            if (failure is VirtualMachineError || failure is ThreadDeath || failure is LinkageError) throw failure
            val tree = runCatching { compose.onRoot().printToString(maxDepth = 15) }.getOrElse { it.toString() }
            throw AssertionError("Expected $description.\n$tree", failure)
        }
    }
}
