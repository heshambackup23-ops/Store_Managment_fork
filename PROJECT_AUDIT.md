# Project Audit

**Phase:** 0, read-only repository and business audit  
**Snapshot:** 2026-11-09  
**Status:** Source inspection complete; live database, build, and runtime behavior are not verified.

## Scope and preservation

The audit was performed against the current worktree. No `.env` secrets were read; only `DB_CONNECTION` was checked (`mysql`). No database, migrations, tests, installers, caches, or production systems were run or changed.

The worktree was already substantially modified before this audit: 970 reported paths (16 under `app/`, 11 other paths, and 943 under `storage/`). Existing wallet implementation changes, deleted migration files, a new wallet migration, and generated-view deletions are user work. They must be preserved. In particular, the audit does not establish that the database has applied the migrations currently on disk.

## Repository map

| Area | Observed responsibility |
| --- | --- |
| `app/Models`, `app/Services`, `app/Http` | Eloquent entities, business operations, web/API controllers, requests, middleware, and policies |
| `routes/web.php`, `routes/cashier.php`, `routes/wallets.php`, `routes/damaged.php` | Session/token-authenticated web workflows and their permission gates |
| `routes/api.php` | The current API surface: one authenticated current-user endpoint |
| `database/migrations`, `database/seeders` | MySQL-compatible schema history, permission tables, and environment-driven system-account synchronization |
| `resources/views` | Arabic-first Blade screens for the discovered modules |
| `resources/js`, `resources/css`, `vite.config.js` | Vite frontend entry points and Bootstrap/jQuery-based web UI |
| `public/uploads`, `storage/app` | Legacy public uploads and Laravel local/public storage |
| `app/Console/Commands`, `routes/console.php` | Backup, account synchronization, and wallet maintenance commands; only the default `inspire` console route was observed |
| Root `.bat`, `.vbs`, `app.conf`, desktop documentation | Windows desktop/portable startup and setup tooling; some scripts are currently invalid due to merge-conflict markers |
| `tests` | PHPUnit feature and unit coverage, including authentication, permissions, invoice creation, installments, suppliers, wallets, notifications, and profile security |

No Android/Kotlin/Gradle project, OpenAPI file, or requested project audit documents existed in the inspected repository.

## Runtime and dependencies

| Component | Evidence |
| --- | --- |
| PHP requirement | `composer.json` requires `^8.2` |
| Local bundled PHP CLI | `php/php.exe -v` reported PHP 8.5.5 |
| Laravel | `composer.lock`: 12.58.0 |
| Sanctum | `composer.lock`: 4.3.2 |
| Spatie Laravel Permission | `composer.lock`: 7.4.1 |
| PHPUnit | `composer.lock`: 11.5.55 |
| Frontend | `package.json` uses Vite `^7.0.7`, Laravel Vite plugin `^2.0.0`, Bootstrap `^5.3.8`, jQuery `^4.0.0`, Chart.js, Font Awesome, and ZXing Browser |
| npm lock | `package-lock.json`, lockfile version 3 |
| Dependency installation | `vendor/` and `node_modules/` were absent; no dependency install or build was attempted |

The local `.env` selects MySQL, while `phpunit.xml` configures SQLite `:memory:` for tests. The checked-in `.env.example` also defaults to MySQL. The actual database schema and migration state were not queried. Laravel's database configuration includes SQLite, MySQL/MariaDB, PostgreSQL, and SQL Server drivers.

## Schema and relationship overview

The migrations define Laravel infrastructure (`users`, sessions, cache, jobs, failed jobs, and personal access tokens), Spatie roles/permissions, and these business areas:

| Area | Tables and observed links |
| --- | --- |
| Catalog | `categories` has many `products`; products hold price, stock, sold count, barcode, image, and category reference |
| Customers and credit | `customers` has installment links; installments reference a product and may reference an invoice and customer record, while also retaining customer/product snapshots and item data |
| Invoices | `invoices` stores a unique invoice number, a first-product reference, customer/date/status, totals, and item snapshots; invoice has many `payments` in the legacy model and may have an installment record |
| Legacy sales | `sales`, `sales_items`, `payments`, and `debts` remain in migrations/models. The current sales page is a report over `products.total_sold`; creation is redirected to invoices. `PaymentsController` methods are mostly stubs. Do not treat these tables as the current transaction source without further proof |
| Suppliers | `suppliers` has purchases and supplier payments; purchases contain total/paid/remaining/status but no purchase-line/product relation was found |
| Wallet ledger | `wallets` has transactions; transactions reference wallet/customer, can reference reversal/settlement rows, and carry unique UUID and idempotency key. Expenses, cash adjustments, and audit logs support the ledger |
| Damaged stock | `damaged_items` optionally references products and records stock snapshots, status, creator, and a unique idempotency key |
| Other | `maintenances`, app notifications/read markers, backup logs, settings, and profile/account fields |

The `profile` Eloquent model maps to the `users` table in the current source, despite a historical `profiles` migration. `User::profile()` uses the same user ID as both keys. Validate the installed database before changing or exposing this shape.

## Feature and workflow inventory

Permission names below are the observed `config/access.php` page keys. The `page.access` middleware resolves a route name to a page module and enforces view/manage permissions; individual routes also apply gates. Roles are dynamic Spatie roles, with special superadmin/system-account handling. This is not a simple fixed-role matrix.

| Module | Current UI and data | Authorization and operations | Mobile suitability / cautions |
| --- | --- | --- | --- |
| Dashboard | `/`, `HomeController`, dashboard view; products and operational totals | `dashboard` page access | Read-only candidate after identifying exact aggregates and query limits |
| Categories | Resource routes and category views; category-to-products | `categories`; create/update/delete gates | CRUD candidate; preserve product/category constraints |
| Products and inventory | Product resource, barcode/label, images, search; category and stock fields | `products`; create/update/delete gates | Read/search is a good first mobile slice. Price/stock are stale offline and never client-authoritative |
| Invoices and cashier | Invoice resource, print/refund, cashier product lookup and checkout | `invoices`; create/update/delete/refund gates; cashier also requires `create-invoice` | High value but consequential. Reuse server service, lock strategy, and a stronger durable replay contract before mobile writes |
| Sales | Listing reports sold quantity from `products.total_sold`; legacy sale detail model exists | `sales` route is within page-access group | Read-only report candidate; not an independent sale-creation workflow |
| Customers | Customer resource and customer-ledger links | `customers`; explicit CRUD gates | Read/search candidate; no assumed ownership/tenant scope was found |
| Installments/debts | Installment list/search/create/update/pay/delete; invoice-linked or standalone debt | `installments`; action gates | Payment and balance changes require live validation and idempotency; standalone debt does not decrement stock |
| Suppliers/purchases/payments | Supplier CRUD, purchase creation, supplier balance and payment allocation | `suppliers` page; requests check manage permission | Mobile candidate after confirming workflow. A purchase currently records a supplied total and payable, not products or stock receipt |
| Wallets and wallet cashier | Wallet CRUD/adjustment, transfer/cash operations, debt settlement, expenses, audit/report pages | `wallets` and `wallet_cashier`; route middleware and request checks | Sensitive financial workflow. Current wallet code is locally modified; audit reflects worktree and must be retested after user changes settle. No provider API integration was found |
| Damaged stock | Record, report, search products, void; optional image | `damaged`; page access and request authorization | Useful mobile workflow; transaction locks stock, stores snapshots, supports persisted idempotency and audit |
| Maintenance | Maintenance resource and repaired transition | `maintenance` | Candidate; confirm allowed status transitions and image/data fields before API design |
| Staff, roles, profile | User management, dynamic permissions, profile/security updates | `staff`, `profile`; role assignment is superadmin-only | Defer user/role administration on mobile until token revocation and object-level policies are explicitly tested |
| Notifications | User read/mark-read plus admin create/delete; read markers | `notifications` | Read-only/personal read state is a candidate; admin writes remain permission-restricted |
| Settings and backup | Settings page and backup export/log | `settings`, `backup`; backup is privileged | Keep backup out of ordinary mobile scope; do not expose database/file exports through a broad API |
| Authentication | Username/password session login, logout, active-account check, Sanctum tokens table | Login throttle and active account validation; no API login/token-issue route found | Native token issuance/revocation must be designed and tested; no registration/reset workflow found |

Image handling is implemented by `PictureStorageService` for JPEG/PNG/WebP with dimension/memory limits, re-encoding, thumbnails, and legacy `public/uploads` support. The current configured disks are local/public and S3. Barcode camera scanning is present in the web cashier via ZXing Browser.

## Transaction map

- **Invoice creation:** `InvoiceCreationService` opens a transaction, locks products in ID order, computes line totals from database prices in cents, checks stock and paid amount, creates the invoice, adjusts stock and `total_sold`, syncs installment data, and creates a notification. Invoice update/refund/delete also lock records and adjust stock/sold counts. Refund restores stock and marks linked installments refunded; deletion is blocked when installments exist.
- **Cashier checkout:** merges duplicate product lines and uses database prices before calling the same invoice service. Its replay marker is a cache entry scoped by user/token, with a 10-minute TTL; it is not the same durable database idempotency contract used by wallet/damaged records.
- **Installments:** standalone debt creation computes from current product prices but does not reduce inventory. Payment locks the installment and, for invoice-linked rows, the invoice; it updates balances/status and emits a notification. No payment idempotency key or separate installment-payment ledger was observed.
- **Supplier purchases/payments:** supplier row is locked; purchase records total/payment type and raises supplier balance for credit. Supplier payment is applied oldest-open-purchase-first under locks and updates supplier balance. There are no purchase item lines or stock updates in the inspected workflow.
- **Wallet ledger:** `WalletLedgerService` is the documented single balance writer; it uses DB transactions, wallet locks, integer cents, append-only reversal rows, audit records, and persisted unique idempotency keys. Do not duplicate its rules in the API or Android.
- **Damaged stock:** `DamagedStockService` locks product stock, writes an immutable snapshot/audit record and decreases stock; voiding preserves the record and restores stock when the product still exists.
- **Maintenance, staff, profile:** transactions exist for selected multi-record edits; preserve the specific existing workflows and permissions rather than generalizing them.

No custom `Jobs`, `Events`, or `Listeners` directories were found. Queue/cache/session drivers in `.env.example` are database-backed, but production behavior and any platform worker/scheduler requirements remain unverified.

## Authentication and authorization

- `User` uses Sanctum `HasApiTokens` and Spatie `HasRoles`; web login is a username/password session flow with session regeneration, a five-attempt username/IP limiter, and active-user check.
- Sanctum stateful API middleware is enabled. `SANCTUM_TOKEN_EXPIRATION` defaults to 60 minutes in config/example. Logout deletes a real personal access token when present and invalidates the session.
- `routes/api.php` has only `GET /api/user` under `auth:sanctum`. It serializes the Eloquent user directly. No API token issuance/revocation endpoint, API Resource, Form Request, version namespace, or OpenAPI contract exists.
- `EnsurePagePermission` checks active status, role permission, and (for bearer requests) a matching token ability. The current `/api/user` route does not use this middleware or `EnsureUserIsActive`; a native API must explicitly enforce active-account rules and authorize every operation.
- Existing role tests demonstrate that token ability and user permission are both required on a test route, and role assignment revokes existing personal tokens. Preserve this two-layer authorization model.
- No tenant/organization boundary was identified in the inspected schema; this is not proof that future deployment or business ownership rules are absent.

## API assessment and proposal

The existing API is an authentication probe, not an Android-ready API. Do not call existing web controllers directly from Android and do not expose Eloquent models. Add a `/api/v1` boundary with thin controllers, Resources, Form Requests, the existing service layer, and explicit policies/page permissions. Use a documented JSON/error contract, bounded pagination/filter allowlists, stable error codes, and query-level access scoping.

Provisional endpoint families (not a frozen contract): session/token issue and revoke plus `me`; categories/products; customers; invoices and invoice detail; cashier checkout or a single shared invoice-creation action; installments and payment actions; supplier payable records; damaged stock; then wallets/notifications/reports only after permission and workflow review. API writes must reuse trusted database prices and the existing transactional services. Consequential operations need server-persisted idempotency keys scoped to user and operation, payload mismatch rejection, replay response, and reconciliation behavior. Do not implement unsupported provider integrations.

## Findings and blockers

1. **The API is not feature-ready.** Only `/api/user` exists; login/token lifecycle and business endpoints are absent.
2. **Raw user serialization and active status:** current API returns a model directly and does not apply the active-account/page permission middleware. Define an explicit Resource and access rule before expanding it.
3. **Replay protections differ by workflow.** Cashier uses a 10-minute cache marker; wallet and damaged items have DB-backed unique keys; installment/supplier writes have no observed request idempotency. Mobile retry semantics cannot be assumed safe.
4. **Existing Windows entry scripts contain conflict markers.** `SETUP_DATABASE.bat`, `START_APP.bat`, and `START_APP_GUI.bat` are not safe to run as-is. They were not executed. `DESKTOP_APP_SETUP.md` documents PHP 7.4, SQLite, and hard-coded starter credentials, which contradict the current Composer constraint and env-driven account synchronization.
5. **Migration state requires reconciliation.** Two migration files share the `2026_10_06_000004` timestamp. The worktree also has two deleted tracked migrations and a new wallet migration. No migration status was queried, so do not run `migrate` until the user-owned changes and actual DB state are reconciled.
6. **Current worktree is not a clean baseline.** It contains 943 storage deletions and local wallet changes. No files were restored, cleared, or overwritten.
7. **Cloud persistence is unresolved.** Local/public disks and local uploads are configured, while Laravel Cloud production persistence requirements are not yet checked. User uploads must not depend on ephemeral deployment storage.
8. **Hosting instruction conflict:** the prompt's detailed Phase 10 selects Laravel Cloud, but its final sentence asks for VPS deployment preparation. Resolve in favor of the explicit Cloud decision only after reviewing the compatibility report; do not prepare VPS-specific infrastructure by assumption.
9. **Legacy schema/workflow ambiguity:** `sales`, `sales_items`, `payments`, `debts`, `cashiers`, and `profiles` artifacts coexist with newer invoice, installment, and supplier flows. Confirm real usage against the database before exposing or migrating them.

## Phase 0 exit status

Source-based audit and proposals are recorded. Live migration state, production behavior, dependency installation, test suite, web build, public network access, Cloud account/resources, and deployment are **not verified**. Review the proposed scope and hosting conflict before Phase 1. No application behavior has been changed.
