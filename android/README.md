# phoneStore Android App

Native Kotlin and Jetpack Compose client for the Laravel `/api/v1` API. Android never connects directly to the application database; Laravel remains authoritative for permissions, prices, invoice totals, and stock.

## Requirements

- Android Studio with JDK 17 configured as its Gradle JDK.
- Android SDK Platform 37 and Android Platform Tools.
- An Android emulator or device for install/run verification.

Open the `android/` directory in Android Studio and allow Gradle sync to finish. The Gradle wrapper downloads Gradle 9.6.1 on first use.

## API URLs

The development flavor defaults to `http://10.0.2.2:8000/api/`, which reaches a Laravel server running on the host from the standard Android emulator. For a physical device, use the development machine's LAN address and ensure Laravel and the firewall accept device connections. Cleartext traffic is allowed only in debug builds.

For a physical device on the same trusted Wi-Fi network:

1. Leave `composer run dev` running if needed; its server listens on loopback only.
2. From another terminal at the repository root, run `composer run dev:android` to start a second Laravel server on `0.0.0.0:8001`. This is for trusted local development only; do not use it on a public network.
3. If Windows Firewall prompts, allow PHP on private networks only.
4. Build and install the development variant using the PC's current LAN IPv4 address:

```powershell
 cd android
 .\gradlew.bat :app:installDevelopmentDebug -PstoreApiDevelopmentUrl=http://192.168.0.31:8001/api/
```

Replace `192.168.0.31` if the PC's Wi-Fi address changes. The emulator continues to use `10.0.2.2`.

Staging and production have intentionally unusable placeholder defaults. Set each URL to the Laravel API base ending in `/api/`; non-debug builds require HTTPS and keep Android's normal certificate validation enabled. Configure Laravel `APP_URL` to a hostname reachable by the device so product image URLs resolve correctly; release image URLs must use HTTPS.

PowerShell examples from the repository root:

```powershell
cd android
.\gradlew.bat :app:assembleDevelopmentDebug -PstoreApiDevelopmentUrl=http://10.0.2.2:8000/api/
.\gradlew.bat :app:installDevelopmentDebug -PstoreApiDevelopmentUrl=http://10.0.2.2:8000/api/
```

For staging or production, pass `-PstoreApiStagingUrl=https://.../api/` or `-PstoreApiProductionUrl=https://.../api/` and build the corresponding `StagingRelease` or `ProductionRelease` variant. Configure release signing in the local Gradle environment before distributing an APK; do not commit signing credentials.

### Release signing

Create an upload key once and keep a secure backup; losing it can prevent updates to the distributed app:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.android\keystores" | Out-Null
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -v -keystore "$env:USERPROFILE\.android\keystores\phoneStore-upload.jks" -alias phoneStore -keyalg RSA -keysize 2048 -validity 10000
```

Put these properties in the user-level Gradle file at `%USERPROFILE%\.gradle\gradle.properties`, not in this repository. Use an absolute keystore path with forward slashes; do not paste passwords into source control:

```properties
storeReleaseStoreFile=C:/Users/<your-user>/.android/keystores/phoneStore-upload.jks
storeReleaseStorePassword=<keystore-password>
storeReleaseKeyAlias=phoneStore
storeReleaseKeyPassword=<key-password>
```

Build only after replacing the URL with the verified public HTTPS API base:

```powershell
cd android
.\gradlew.bat :app:assembleProductionRelease -PstoreApiProductionUrl=https://api.example.com/api/
```

## Current app scope

- Arabic RTL sign-in, session restore/revoke, and permission-aware navigation.
- Arabic account/profile screen backed by `/v1/me`, with module permissions translated into Arabic labels.
- Active-session `401` responses clear the local token/cache and return to sign-in without a redundant revoke request.
- Paginated product, category, customer, and invoice lists with search and refresh; product category and stock-availability filters use the Laravel query contract.
- Product detail sheet backed by the authorized `/v1/products/{id}` endpoint, with a visibly labeled cached fallback when the request fails.
- Customer, category, invoice, and supplier detail sheets use their authorized v1 detail endpoints and display Arabic fallback/error states.
- Product thumbnails and detail images use the API's public image URLs with placeholders for missing/unreachable files.
- Invoice detail sheet backed by the authorized `/v1/invoices/{id}` endpoint, including server-recorded totals and item snapshots.
- Room cache for products/categories; cached price and stock are informational and may be stale.
- Category/customer create, edit, and delete when the server grants the relevant permission.
- Read-only supplier directory and payable summary when the server grants `page.suppliers.view`; purchase and payment actions remain unavailable.
- Read-only installment list and detail when the server grants `page.installments.view`; debt creation and payment actions remain unavailable.
- Online invoice creation with a stable idempotency key. Laravel computes totals and validates current stock. Financial and inventory writes are not queued offline.
- Invoice product selection supports on-device barcode/QR scanning through Google Play services Code Scanner, plus manual name/barcode filtering. Scanned codes are looked up against Laravel's product search and do not determine price or stock.
- Invoice form accepts Arabic-Indic digits and checks the date/payment format before submission; Laravel remains the final validator.
- Invoice status/date values and cached timestamps are presented using Arabic labels and formatting.
- The customer/category/invoice create APIs require the additive idempotency migration to be applied to the target development database before those actions can succeed. No migration was run as part of this Android work.
- Barcode scanning requires a compatible Google Play services installation; manual product filtering and selection remain available when the scanner cannot start. The app does not request camera permission.

## Verification

The development debug APK builds with `:app:assembleDevelopmentDebug`; the artifact is written to `app/build/outputs/apk/development/debug/app-development-debug.apk`. Android unit tests pass with `:app:testDevelopmentDebugUnitTest` (17 tests, 0 failures), and `:app:lintDevelopmentDebug` passes with 0 errors. `:app:assembleProductionRelease` also succeeds, but without signing properties it produces an unsigned APK using the placeholder API host. A physical phone has the LAN-configured debug APK installed; phone-to-PC TCP access and the Laravel `/up` health route were verified. Credential login, barcode scanning, accessibility, and production endpoint behavior still require on-device verification.
