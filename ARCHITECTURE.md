# Proposed Architecture

**Status:** Core Phase 1 API available; native Android foundation and initial workflows implemented, awaiting Android toolchain verification.

## System boundary

Laravel remains the sole authority for users, permissions, product prices, stock, sales/invoices, installments, supplier balances, wallet balances, and all other business state. The Blade web application and a native Android application use the same Laravel services and database. Android never connects directly to the database and never decides authoritative totals or permissions.

```text
Android Compose UI
  -> ViewModel / UI state
  -> repository (Flow)
  -> Retrofit + OkHttp / Room
  -> versioned Laravel JSON API
  -> Form Request + policy/page permission
  -> existing service and transaction rules
  -> Eloquent / configured database
```

## Laravel API boundary

- Add `/api/v1` without changing existing web routes.
- Keep controllers thin; validate with Form Requests; serialize with API Resources rather than raw models.
- Enforce `is_active`, Sanctum authentication, token abilities, and current Spatie permissions/policies on every route. Token abilities narrow access; they do not grant business permission.
- Reuse `InvoiceCreationService`, `InvoiceInstallmentSync`, `DamagedStockService`, `WalletLedgerService`, and existing supplier/installment transaction behavior. Extract logic only when required to share it safely with API and web clients.
- Use transactions and current row-lock order for stock, money, installment, and payable writes. Introduce database-backed idempotency for consequential operations before allowing mobile retries.
- Document versioned request/response semantics, error codes, pagination, sorting allowlists, and conflict/reconciliation behavior before Android feature screens.

The current additive v1 slice provides Sanctum token issue/revoke, a minimal `/me`, authorized product/category/customer/invoice lists, customer/category CRUD, and idempotent invoice creation. The legacy `/api/user` remains for compatibility and is not the v1 contract. See `API_DOCUMENTATION.md` and `openapi.yaml`.

## Authentication proposal

Keep the existing username/password and active-account policy. The v1 API now issues/revokes Sanctum personal access tokens with scoped abilities, configured expiration, and the existing login throttle. Store credentials using Android Keystore-backed protection; never place tokens in ordinary preferences, logs, or queued work payloads. Logout/account switching clears private Room data and revokes the correct token.

## Android proposal

The initial native Kotlin/Compose app uses Material 3, lifecycle ViewModels, coroutines/Flow, Navigation Compose, Retrofit/OkHttp, Kotlin Serialization, Hilt, Room, and DataStore for non-sensitive preferences. WorkManager is not used for financial or stock writes. Development/staging/production product flavors are configured; release builds reject cleartext traffic and retain normal certificate validation. Build instructions and remaining environment prerequisites are in `android/README.md`.

## Initial scope proposal

The initial client includes authentication, catalog/customer/invoice lists, customer/category management, and online invoice creation. Cached prices and stock are informational; Laravel remains authoritative. Other inventory, installment, supplier-payment, wallet, and damaged-stock changes remain unavailable until their contracts and replay/reconciliation tests exist. Do not create mobile screens for unverified legacy tables or payment-provider integrations.

## Decisions not yet made

- Final API resource shapes and which modules the user wants in the first release.
- Token name/abilities/expiration and active-user invalidation policy.
- Whether Laravel Cloud remains the deployment target, given the prompt's conflicting final VPS sentence.
- Cloud database, queue/cache resources, persistent image storage, region, plan, and custom domain.
- Whether currently dirty wallet work is complete and safe to freeze as the mobile contract.

## Implementation Status

The v1 API currently includes token issue/revoke, a minimal current-user resource, authorized paginated list/detail reads for products/categories/customers/invoices, category/customer CRUD, and idempotent invoice creation through the existing transaction service. The Android app is implemented in source but has not been built or run; Android Studio/JDK/SDK are unavailable in the current environment. Category, customer, and invoice creation use the additive idempotency table migration, which has not been applied to a live database. Other business writes remain unavailable.
