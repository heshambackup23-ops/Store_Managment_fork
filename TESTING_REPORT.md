# Testing Report

**Snapshot:** 2026-11-09  
**Environment:** VS Code test runner; Laravel feature tests use the SQLite in-memory configuration in `phpunit.xml`.

## Executed

| Scope | Result |
| --- | --- |
| All `ApiV1*Test.php` files | 52 passed, 0 failed |
| `ApiV1ReadEndpointsTest.php` (focused list/detail/customer-write run) | 14 passed, 0 failed |
| `ApiV1CategoryWriteTest.php` (focused run) | 4 passed, 0 failed |
| `AuthenticationTest.php` | 10 passed, 0 failed |
| `InvoiceCreationTest.php`, `InstallmentPaymentTest.php`, `SupplierAccountsPayableTest.php` | 26 passed, 0 failed |
| `RoleAccessTest.php` | 6 passed, 14 failed |
| Full test suite (before detail/customer/category-write additions) | 127 passed, 33 failed |

The API tests cover token issue/revoke, credential normalization, disabled accounts, login throttling, token abilities and permissions, minimal resources, input errors, list/detail serialization, pagination/search/filtering, stable not-found responses, idempotent customer/category creation, customer/category update/delete behavior, invoice creation through the existing service, stock updates, identical replay, mismatched-payload conflict, and rollback on insufficient stock.

## Existing Failures and Limits

`RoleAccessTest` failures include role pages returning 403 because `EnsurePagePermission` derives a `roles` page module not present in `config/access.php`. Other full-suite failures include product/maintenance notes persistence, wallet audit/cashier/creation tests, and a product-view test that hit a Windows access-denied error while renaming a compiled Blade view under `storage/framework/views`. These failures are outside the new API test files; no clean full-suite baseline was captured before these edits, so causality is not established. The full suite was not rerun after adding detail-read and customer-write tests.

Invoice idempotency replay was tested sequentially on SQLite. Simultaneous duplicate requests have not been tested against MySQL or the future production database engine. The new migration has not been applied to the configured local MySQL database or production.

No Composer install, npm build, dependency/security scan, Cloud deployment, or live database/migration check was performed. The full-suite run interacted with the already-dirty compiled-view directory; the pre-existing deleted storage files were not restored or regenerated. API feature files were executed with the VS Code test runner; no shell PHPUnit command was run in this session.

Android verification: with JDK 17 and Android SDK Platform 37, `:app:testDevelopmentDebugUnitTest` passed 21 tests with 0 failures; `:app:assembleDevelopmentDebug` and `:app:assembleProductionRelease` succeeded; and `:app:lintDevelopmentDebug` passed with 0 errors. The production APK is unsigned at `android/app/build/outputs/apk/production/release/app-production-release-unsigned.apk` and uses the intentionally invalid placeholder API host; optional release signing is configured through user-level Gradle properties but was not tested with credentials. The latest LAN-configured debug APK, including sales, notifications, maintenance, supplier/debt add forms, and the wallet overview, is installed on the connected phone. Laravel `/up` returned HTTP 200 through the PC's Wi-Fi address, and an ADB TCP probe from the phone to port 8001 succeeded. Credential login and the new UI flows have not yet been exercised interactively. Gradle reports that two native libraries were packaged without stripping.

Latest Laravel slice: supplier-create, standalone installment-create, wallet-overview, sales-report, maintenance-read, and notification feature tests plus existing installment/supplier workflow regressions passed 130 tests with 0 failures. Supplier and installment creates require the additive idempotency migration on the target development database; no production migration was run.
