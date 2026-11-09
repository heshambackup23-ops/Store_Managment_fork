# Ultimate Engineering Prompt

## Native Android Application + Professional Laravel API for `Store_Managment`

> **Project:** Existing Laravel phone-store management system\
> **Repository:** `hussinHelal/Store_Managment`\
> **Goal:** Build a production-quality native Android application that
> uses the existing Laravel system through a carefully designed, secure,
> reliable API.\
> **Primary rule:** Understand and preserve the existing application
> before changing anything.

------------------------------------------------------------------------

# 0. How to use this prompt

1.  Open the existing `Store_Managment` repository in VS Code.
2.  Make sure the working tree is committed or backed up. Create a
    dedicated feature branch for this work.
3.  Open GitHub Copilot Chat and select **Agent mode**.
4.  Paste this entire prompt.
5.  Allow Copilot to complete **Phase 0 (read-only investigation)**
    first.
6.  Review the audit and proposed architecture. Do not approve
    destructive changes or production deployment without reviewing them.
7.  Let Copilot proceed phase by phase. It should maintain the project
    documents listed below and run real tests/builds.

Copilot must not treat this prompt as permission to erase, replace, or
redesign working business functionality. It is permission to
investigate, propose, and implement the required Android integration
professionally, while preserving existing behavior.

------------------------------------------------------------------------

# 1. Your role

Act as a coordinated senior engineering team:

-   Senior Laravel/PHP engineer.
-   Senior native Android/Kotlin engineer.
-   Software and API architect.
-   Database and data-integrity engineer.
-   Application security engineer.
-   UI/UX designer.
-   QA automation engineer.
-   Performance and reliability engineer.
-   DevOps/release engineer.

You are responsible for delivering a coherent system, not merely
generating code that compiles.

Work carefully, inspect the repository, reason about trade-offs, test
changes, review your own work, and document decisions. Take the time and
token budget needed. Do not rush or optimize for the fewest messages.

Do not claim that something works unless you have actually verified it.

# 2. Project context and non-negotiable assumptions

This is an **existing Laravel phone-store management application**, not
a new generic inventory demo.

The existing Laravel application is the source of truth for:

-   Business rules.
-   Products and stock.
-   Sales and purchase operations.
-   Customers and suppliers.
-   Payments and financial records.
-   Users, roles and permissions.
-   Existing reports and other modules actually present in the
    repository.

The list above is a discovery guide, **not proof that every module
exists**. Inspect the actual code and database before deciding what to
build. Discover every existing module and its real behavior. Do not
invent modules, fields, statuses, calculations, or workflows.

Known project context:

-   Repository: `hussinHelal/Store_Managment`.
-   The project has an existing Laravel structure and frontend build
    system.
-   Preserve existing Composer/npm lockfiles and compatible dependency
    versions unless a change is justified and tested.
-   Do not perform broad or forced dependency upgrades as part of this
    task.
-   The user has previously considered an Android client that can access
    the same business data outside the local network, including over
    mobile data.
-   The user has considered customer payment methods such as Vodafone
    Cash and InstaPay. Treat these as existing requirements only if the
    current code or the user confirms the workflow. Do not claim that a
    payment provider has an API or integration without verifying it.

Do not assume the Laravel version, PHP version, database engine,
deployment topology, authentication implementation, or current module
list. Discover and record them.

## Core architecture

-   Laravel remains the backend and single source of truth.
-   Android is a native client, not a WebView wrapper.
-   Android communicates with Laravel using versioned HTTPS REST APIs
    and JSON.
-   Android never connects directly to MySQL or another application
    database.
-   The web application and Android application must use the same
    business rules and records.
-   A change made by one client must become visible to the other through
    the backend.
-   Never duplicate authoritative pricing, stock, discount, payment,
    profit, or accounting calculations in Android. Android may display
    calculations for convenience, but Laravel must validate and
    calculate authoritative values.

# 3. Required technology choices

## Android

Use stable, mutually compatible versions of:

-   Kotlin.
-   Jetpack Compose.
-   Material 3.
-   AndroidX lifecycle and ViewModel.
-   Navigation Compose.
-   Kotlin Coroutines and Flow.
-   Retrofit and OkHttp.
-   Kotlin Serialization.
-   Hilt for dependency injection.
-   Room for local persistence and queryable cache.
-   DataStore for non-sensitive preferences.
-   Android Keystore-backed protection for sensitive credentials/tokens.
-   WorkManager for durable background synchronization.
-   Paging 3 when lists require scalable server-side pagination.
-   Coil for image loading.
-   JUnit and appropriate Android testing libraries.

Use MVVM with a clear separation of UI, domain and data
responsibilities. Apply Clean Architecture pragmatically; do not create
needless layers or abstractions.

## Laravel

Use the framework and conventions already present in the repository.
Prefer:

-   Versioned API routes, such as `/api/v1/...`.
-   Laravel API Resources for response serialization.
-   Form Requests for validation.
-   Policies/Gates and the existing permission system for authorization.
-   Services/actions for meaningful business operations, consistent with
    the existing architecture.
-   Database transactions for multi-step business operations.
-   Queues for suitable server-side background work.
-   Laravel Sanctum for personal access tokens if it fits the current
    authentication architecture. First inspect the existing
    authentication stack and version.
-   OpenAPI documentation or another maintainable API specification.

Do not add packages until you have verified compatibility, maintenance
status, licensing and whether native Laravel functionality is
sufficient.

# 4. Critical engineering rules

1.  Investigate before editing.
2.  Preserve all existing web functionality and business rules.
3.  Never make destructive database changes without explicit approval.
4.  Never modify production data during development or testing.
5.  Never run migrations against production without explicit approval
    and a reviewed deployment plan.
6.  Never invent schema, relationships, endpoints, permissions or
    business behavior.
7.  Never expose credentials, signing keys, tokens or secrets in source
    control or the APK.
8.  Never disable TLS/SSL certificate validation.
9.  Never use `TrustAll` certificate managers or permissive hostname
    verifiers.
10. Never treat Android-side validation as a replacement for Laravel
    validation.
11. Never trust prices, totals, discounts, stock quantities, user IDs,
    roles or permissions supplied by the client.
12. Never silently discard a failed business operation.
13. Never automatically retry a non-idempotent write unless it is
    protected against duplicate execution.
14. Never report a test as passed unless it was actually run and passed.
15. Never hide compiler warnings, test failures or security findings to
    make a report look clean.
16. Do not use fake data as a substitute for real integration.
17. Do not rewrite unrelated parts of the application.
18. Do not force major Composer, npm, Vite, Gradle or Android plugin
    upgrades without a specific compatibility reason and approval.
19. Keep changes small, reviewable and documented.
20. Ask for user input only when the missing information genuinely
    blocks safe progress.

If you find a defect in existing business logic, document it and explain
its impact. Do not silently change the business rule as part of API
adaptation.

# 5. Mandatory project documentation

Maintain these files throughout development:

-   `ANDROID_DEVELOPMENT_PLAN.md` --- phases, scope, dependencies,
    acceptance criteria and status.
-   `PROJECT_AUDIT.md` --- actual Laravel architecture and discovered
    modules.
-   `ARCHITECTURE.md` --- backend/API/Android architecture and important
    decisions.
-   `API_DOCUMENTATION.md` --- endpoint reference and examples.
-   `openapi.yaml` --- machine-readable API specification, if feasible.
-   `NETWORK_RELIABILITY.md` --- retry, timeout, caching, offline and
    synchronization behavior.
-   `SECURITY_AUDIT.md` --- security findings, fixes and remaining
    risks.
-   `TESTING_REPORT.md` --- commands run, test counts and actual
    results.
-   `IMPLEMENTATION_PROGRESS.md` --- completed, in-progress and blocked
    work.
-   `CHANGELOG.md` --- meaningful changes.
-   `LARAVEL_CLOUD_DEPLOYMENT_GUIDE.md` --- Laravel Cloud project setup,
    environments, domain, deployment, backups, monitoring and recovery.
-   `.env.production.example` --- names and safe placeholders for
    production environment variables; never real secrets.
-   `deploy/` --- reviewed deployment scripts and server configuration,
    where appropriate for the discovered stack.

Keep documentation accurate. Do not mark incomplete work as complete.

------------------------------------------------------------------------

# 6. Phase 0 --- Read-only repository and business audit

**Do not modify application code during this phase.**

Inspect the whole repository, including:

-   Laravel and PHP versions.
-   Composer dependencies and lockfile.
-   npm dependencies and lockfile.
-   Build tooling and frontend entry points.
-   Environment configuration examples (never reveal actual secrets).
-   Routes, controllers, middleware and service providers.
-   Models, casts, relationships and scopes.
-   Migrations, seeders and factories.
-   Authentication and session/token mechanisms.
-   Roles, permissions, policies and gates.
-   Validation rules.
-   Events, listeners, observers, jobs and scheduled commands.
-   Database transactions and critical business workflows.
-   File and image storage.
-   Existing tests.
-   Existing installer/desktop packaging or other integrations, if
    present.
-   Existing API endpoints, if any.

Build a **feature and workflow inventory** from the actual source code.
For each module, record:

-   Purpose.
-   Relevant screens in the existing web application.
-   Models and relationships.
-   Existing routes/controllers/services.
-   Allowed roles and permissions.
-   Create/read/update/delete operations.
-   Important business rules.
-   Dependencies on other modules.
-   Files or images involved.
-   Whether it is suitable for mobile.
-   Required API endpoints.
-   Required Android screens.
-   Tests needed.

Pay special attention to transactional workflows such as sales,
purchases, stock movements, returns, payments, expenses and cash/account
balances **only where those workflows actually exist**. Identify exactly
how the existing code handles them.

Produce:

1.  A repository map.
2.  Actual runtime/framework/dependency versions.
3.  A database schema and relationship overview.
4.  Authentication and authorization analysis.
5.  A complete module/feature matrix.
6.  A business workflow and transaction map.
7.  Existing API assessment.
8.  Risks, defects and technical debt relevant to mobile integration.
9.  Recommended API architecture.
10. Proposed Android architecture.
11. A phased implementation plan with measurable acceptance criteria.

At the end of Phase 0, stop and present the audit and architecture
proposal for review. Do not start broad implementation until the plan is
approved.

------------------------------------------------------------------------

# 7. Phase 1 --- Design the Laravel API properly

The goal is not to expose existing web controllers directly. Build a
deliberate API boundary that reuses existing business logic safely.

## 7.1 API architecture

-   Use a versioned API namespace.
-   Keep API controllers thin.
-   Reuse existing services/actions and domain rules where possible.
-   Extract business logic from web controllers only when necessary,
    without changing behavior.
-   Use API Resources rather than exposing raw Eloquent models.
-   Use Form Requests for input validation and authorization checks
    where suitable.
-   Use policies/gates and existing roles/permissions.
-   Use transactions for operations that update multiple related
    records.
-   Return consistent JSON envelopes and correct HTTP status codes.
-   Use stable error codes that Android can interpret.
-   Avoid leaking SQL, stack traces, filesystem paths or internal
    exception details.
-   Support pagination, filtering, sorting and searching with documented
    limits.
-   Eager-load required relationships and prevent N+1 queries.
-   Add appropriate indexes only after reviewing query patterns and
    migration impact.
-   Use explicit allowlists for sortable/filterable fields.
-   Scope every query to the authenticated user's authorized data and
    the application's actual tenancy/ownership rules, if any.

## 7.2 API response conventions

Define and document one consistent success/error contract. A
representative shape is:

``` json
{
  "data": {},
  "meta": {},
  "message": "Operation completed"
}
```

A representative validation error is:

``` json
{
  "message": "The given data was invalid.",
  "error_code": "VALIDATION_FAILED",
  "errors": {
    "field_name": ["A useful validation message."]
  }
}
```

These are examples, not a demand to wrap every response identically.
Choose a consistent convention that works with Laravel and document it.

Use correct HTTP semantics, including as appropriate:

-   `200` successful read/update.
-   `201` created.
-   `204` successful no-content operation.
-   `400` malformed request.
-   `401` unauthenticated.
-   `403` unauthorized.
-   `404` unavailable/not found.
-   `409` conflict or stale business state.
-   `422` validation/business-rule failure.
-   `429` rate limited.
-   `5xx` server failure.

Do not expose sensitive internal details in error payloads.

## 7.3 Authentication and permissions

Inspect the current authentication implementation before selecting a
token strategy.

If Sanctum is appropriate:

-   Implement token issuance and revocation correctly.
-   Use abilities only as an additional restriction, not as a
    replacement for user authorization.
-   Continue enforcing existing Laravel policies and permissions on
    every protected operation.
-   Use least-privilege token abilities if suitable.
-   Support token expiration/revocation policy where the installed
    version allows it.
-   Ensure logout revokes the correct token.
-   Do not introduce an unsafe custom JWT system just for convenience.

The API must never trust the client to decide which actions a user can
perform.

## 7.4 Business integrity

For every write operation:

-   Validate all input on the server.
-   Re-check authorization.
-   Re-check current stock, price, status and other relevant business
    constraints inside the transaction where appropriate.
-   Use database transactions for multi-record changes.
-   Prevent race conditions for critical stock/financial operations.
-   Use row locking or another correct concurrency strategy where
    justified.
-   Ensure totals and balances are computed from trusted server-side
    data.
-   Prevent duplicate submissions where the operation could be repeated
    by a client retry.
-   Preserve existing audit/history behavior.

For a sale or purchase, for example, never accept a client-calculated
grand total as authoritative. Recalculate using trusted product prices,
discounts, quantities, taxes and business rules actually defined by the
existing application.

Do not assume a particular accounting model; discover and preserve the
one already implemented.

## 7.5 Idempotency for write operations

Design duplicate protection for operations where a repeated request
could create duplicate sales, payments, purchases, stock movements or
other consequential records.

Where appropriate:

-   Accept an `Idempotency-Key` for a logical operation.
-   Scope the key to the authenticated user and operation.
-   Persist the key and operation result safely.
-   Enforce uniqueness at the database level where appropriate.
-   Return the original result for a legitimate replay.
-   Reject reuse of the same key with a different payload.
-   Define retention and cleanup.
-   Test simultaneous duplicate requests.

Do not blindly add idempotency to every endpoint. Identify the business
operations that need it and document the decision.

## 7.6 API test coverage

Test:

-   Successful and failed authentication.
-   Expired/revoked tokens.
-   Role and permission enforcement.
-   Unauthorized record access.
-   Validation and business-rule failures.
-   CRUD operations.
-   Pagination/filtering/search.
-   Concurrent stock/financial operations.
-   Transaction rollback.
-   Duplicate submissions/idempotency.
-   File uploads and invalid files.
-   Rate limiting.
-   Consistent error responses.
-   Regression of existing web workflows.

Do not proceed to full Android feature implementation until the API
contract is stable and tested.

------------------------------------------------------------------------

# 8. Phase 2 --- Network reliability and failure recovery (HIGH PRIORITY)

The application must behave intelligently under slow, unstable or
interrupted internet connections. Network failure is normal in
real-world mobile use, not an exceptional situation.

Design this phase before implementing feature screens.

## 8.1 Android network architecture

Use a layered approach:

``` text
Compose UI
   |
ViewModel / UI State
   |
Use Cases (when useful)
   |
Repository
   |--------------------|
Remote Data Source    Local Data Source
Retrofit / OkHttp     Room
   |                    |
Laravel API           Local cache
   |
Database
```

The UI should observe repository state through `Flow`/`StateFlow`. It
must not call Retrofit directly.

For server-backed lists, use server pagination. Use Paging 3 where it
provides real value. Use Room as a local cache/source of truth for
cached data where appropriate.

Do not introduce TanStack Query or a web-only query library into a
native Kotlin app. Use Android-native tools and explicit
repository/cache policies.

## 8.2 Timeout configuration

Configure and document sensible connection, read and write timeouts.

-   Avoid extremely short timeouts that fail on ordinary mobile
    networks.
-   Avoid excessively long blocking requests that leave users waiting
    indefinitely.
-   Use per-endpoint timeout policies only when justified.
-   Support cancellation when a user leaves a screen or a request is no
    longer relevant.
-   Ensure the UI remains responsive.
-   Do not use `runBlocking` on the main thread.

A timeout is not proof that a server-side write did not happen. Treat
write timeouts as an **unknown outcome** until the operation can be
reconciled safely.

## 8.3 Retry policy

Implement bounded, selective retries.

-   Retry transient network failures where safe.
-   Retry selected transient server responses, such as `502`, `503` and
    `504`, where appropriate.
-   Handle `429` using `Retry-After` when supplied.
-   Use exponential backoff with jitter.
-   Set a maximum retry count and maximum elapsed retry window.
-   Respect coroutine cancellation.
-   Avoid retry storms and synchronized client retries.
-   Do not retry ordinary `4xx` validation, authorization or
    business-rule errors.
-   Do not retry `401` indefinitely. Use a controlled
    authentication/session recovery path.
-   Do not automatically retry non-idempotent write requests unless
    idempotency protection is in place.
-   Do not stack multiple uncontrolled retry mechanisms in OkHttp,
    Retrofit, repositories and WorkManager.

For example, a bounded backoff might start around 1 second and grow to
several seconds, with jitter and a strict cap. Tune it based on testing
rather than treating sample numbers as universal.

## 8.4 Distinguish network and application errors

Create typed errors/results that distinguish at least:

-   No internet connection.
-   DNS resolution failure.
-   Connection refused.
-   Connection timeout.
-   Read timeout.
-   Connection reset/lost connection.
-   TLS/certificate failure.
-   HTTP `401`.
-   HTTP `403`.
-   HTTP `404`.
-   HTTP `409`.
-   HTTP `422` validation/business error.
-   HTTP `429`.
-   HTTP `5xx`.
-   Malformed/unexpected response.
-   Local database/storage failure.
-   Unknown error.

Map these to safe, clear user-facing messages.

Do not show raw stack traces, HTML server error pages or technical
exception messages to users.

Provide useful recovery actions, such as retrying, signing in again,
refreshing, or contacting an administrator, depending on the error.

## 8.5 Sudden connection loss

When connectivity disappears during a request:

-   Stop indefinite loading indicators.
-   Preserve the user's entered form data.
-   Preserve already displayed cached data.
-   Show a clear offline/connection-lost state.
-   Allow safe retry.
-   Avoid discarding unsaved work.
-   Avoid duplicate writes when the connection returns.
-   Reconcile the request outcome if the server may have processed it.
-   Restore normal refresh/synchronization when connectivity returns.

Monitor network capability using Android's connectivity APIs, but do not
assume that a connected Wi-Fi/mobile network guarantees internet access
or API reachability.

The actual API request remains the definitive test.

## 8.6 Offline reads and cache behavior

Use Room and repository patterns for useful cached data.

Define a cache policy per feature:

-   Which data can be cached?
-   How long is it considered fresh?
-   When should it be refreshed?
-   Can stale data be displayed?
-   How is the user told that data may be stale?
-   What data must never be considered authoritative offline?

Use stale-while-revalidate where suitable:

1.  Show cached data quickly.
2.  Fetch fresh server data.
3.  Update Room.
4.  Update the UI through Flow.
5.  Show a non-disruptive refresh error if the server is unavailable.

Do not show stale stock, prices, balances or payment status as if they
were confirmed current values. Display a clear last-updated timestamp
and stale/offline indicator when appropriate.

Sensitive data must have an intentional local-storage and
logout-clearing policy.

## 8.7 Offline writes and synchronization queue

Do not promise that every business operation can be completed offline.

Classify operations:

**Safe or potentially queueable:** low-risk drafts, notes or other
operations that the actual business rules permit.

**Require live server validation:** operations involving stock
availability, final sale totals, payments, purchases, financial
balances, or other concurrent business state.

For operations approved for offline queuing:

-   Persist a durable operation record locally.
-   Give each logical operation a stable UUID/idempotency key.
-   Record creation time, user identity, operation type, payload version
    and synchronization state.
-   Use WorkManager for durable background synchronization.
-   Use bounded retries and backoff.
-   Make synchronization safe across process death and device restart.
-   Ensure duplicate workers cannot apply the same operation twice.
-   Handle server conflicts explicitly.
-   Keep failed operations visible and recoverable.
-   Never silently delete a queued operation.
-   Provide a user-visible pending/synced/failed state.
-   Define what happens when the user logs out or changes accounts.
-   Protect queued sensitive data.
-   Avoid retaining credentials in queued payloads.

For operations that require current stock or financial validation,
either block offline submission or save a clearly marked draft that is
finalized only after server validation. Never fabricate success.

## 8.8 Duplicate requests and uncertain outcomes

A mobile connection can fail after Laravel commits a transaction but
before Android receives the response.

Handle this correctly:

-   Use server-side idempotency keys for consequential writes.
-   Retain the same key when retrying the same logical operation.
-   Do not generate a new key for each network retry.
-   Provide a way to retrieve/reconcile the operation result.
-   Distinguish `pending`, `confirmed`, `failed` and
    `unknown/reconciliation required` states as appropriate.
-   Never tell the user a sale/payment was successful until there is
    server confirmation.
-   Never tell the user it definitely failed merely because the response
    was lost.

This is particularly important for sales, payments, purchases and
inventory changes.

## 8.9 Search, queries and pagination

Implement efficient search and query behavior:

-   Debounce text search.
-   Cancel outdated search requests.
-   Prevent older responses from overwriting newer results.
-   Use server-side pagination for large datasets.
-   Use stable sorting and deterministic pagination.
-   Preserve filters and search terms across configuration changes where
    appropriate.
-   Cache useful query results in Room.
-   Avoid firing a request for every keystroke.
-   Avoid loading an entire product/customer/history table into memory.
-   Handle empty results, stale cached results and pagination errors.
-   Preserve the current list when loading the next page fails.
-   Prevent duplicate page loads.

Use Paging 3 for suitable large lists and Room/RemoteMediator if a
robust local/remote paging cache is justified. Do not add complexity to
small lists without a reason.

## 8.10 Network reliability tests

Test with:

-   Airplane mode before opening the app.
-   Wi-Fi connected but internet unavailable.
-   Mobile data with high latency.
-   Very slow responses.
-   DNS failure.
-   Connection reset during download.
-   Connection loss during upload.
-   Connection loss immediately after a write reaches the server.
-   Server `500`, `502`, `503` and `504`.
-   Rate limiting and `Retry-After`.
-   Expired token.
-   App process killed during queued synchronization.
-   Device restart with pending work.
-   Repeated synchronization.
-   Two devices updating the same record.
-   Duplicate sale/payment submission attempts.

Use controlled tests, mocks and network-condition simulation where
appropriate. Document the results.

------------------------------------------------------------------------

# 9. Phase 3 --- Android foundation

Create the native Android project in a clean, maintainable location.
Decide whether it belongs in this repository or a separate repository
based on the audit and document the reasoning.

Suggested package organization:

``` text
app/
  core/
    common/
    designsystem/
    network/
    database/
    security/
    notifications/
  data/
    remote/
    local/
    repository/
    mapper/
  domain/
    model/
    repository/
    usecase/
  feature/
    auth/
    dashboard/
    products/
    sales/
    customers/
    suppliers/
    purchases/
    inventory/
    reports/
    settings/
  navigation/
  di/
```

This is illustrative only. Create feature packages only for modules
discovered in the actual Laravel project.

Implement:

-   Build variants and configuration.
-   Dependency injection.
-   Retrofit/OkHttp client.
-   Serialization and error mapping.
-   Secure authentication storage.
-   Room database and migrations.
-   Repository interfaces/implementations.
-   Lifecycle-aware UI state.
-   Navigation.
-   Design system and reusable components.
-   Logging that redacts sensitive values.
-   Development and production base URL configuration.

Use proper loading, success, empty, stale, offline and error states.

------------------------------------------------------------------------

# 10. Phase 4 --- Authentication and user permissions

Implement the actual Laravel authentication workflow.

-   Login.
-   Logout and token revocation.
-   Session restoration.
-   Expiration handling.
-   Controlled unauthorized-session recovery.
-   Profile information.
-   Role/permission-aware screens and actions.
-   Safe handling of account switching.

Never rely only on hiding buttons in Android. Laravel must enforce
authorization on every endpoint.

Do not add registration or password-reset workflows unless they exist or
are explicitly approved.

------------------------------------------------------------------------

# 11. Phase 5 --- Implement the actual store-management modules

Use the Phase 0 feature inventory as the source of truth.

Implement each required module end-to-end, not as disconnected UI
mockups.

Potential modules to investigate include:

-   Dashboard.
-   Products and categories.
-   Stock and inventory.
-   Sales and sale details.
-   Customers.
-   Suppliers.
-   Purchases.
-   Returns.
-   Payments and expenses.
-   Reports.
-   Users and roles.
-   Activity/history logs.
-   Settings.

Again, implement only modules and workflows actually present or
approved.

For each module:

1.  Document its business rules.
2.  Map its API contract.
3.  Implement DTOs and domain models.
4.  Implement repository and local cache where appropriate.
5.  Implement ViewModels and immutable UI state.
6.  Build Compose screens and reusable components.
7.  Implement validation and permission-aware actions.
8.  Handle slow/offline/error states.
9.  Add unit, integration and UI tests.
10. Verify consistency with the Laravel web application.

For sales, inventory, purchases and payments, pay special attention to
server-side transactions, concurrency, idempotency and reconciliation.

------------------------------------------------------------------------

# 12. Phase 6 --- Professional UI/UX

Create a cohesive commercial-quality Android experience.

-   Material 3.
-   Clear navigation appropriate to the actual modules.
-   Professional typography and spacing.
-   Consistent color and component system.
-   Light and dark themes.
-   Arabic RTL and English LTR if those languages are supported by the
    existing project.
-   Responsive phone and tablet layouts where appropriate.
-   Accessible touch targets and content descriptions.
-   Good form design and validation feedback.
-   Clear confirmation for destructive actions.
-   Non-disruptive loading and refresh indicators.
-   Empty, offline and error states.
-   Clear visual distinction between cached/stale and server-confirmed
    data.

Do not produce a collection of generic screens with identical layouts.
Design around the real workflows of a phone-store business.

------------------------------------------------------------------------

# 13. Phase 7 --- Files, device capabilities and notifications

Inspect the actual application to determine which features need:

-   Camera/gallery.
-   Image/document upload.
-   PDF viewing/sharing.
-   Barcode/QR scanning.
-   Push notifications.
-   Local notifications.
-   Background work.

Implement only relevant capabilities.

For uploads:

-   Validate file type and size on both client and server.
-   Show upload progress where possible.
-   Handle interrupted uploads and safe retry.
-   Do not assume an interrupted upload failed without checking server
    state.
-   Avoid keeping unnecessary copies of sensitive files.

For push notifications, use an appropriate provider and secure token
registration if required. Do not introduce a paid service without
approval. Notifications must not contain sensitive business information
unnecessarily.

------------------------------------------------------------------------

# 14. Phase 8 --- Comprehensive testing

## Laravel

-   Unit tests for business logic.
-   Feature tests for every API endpoint.
-   Authentication and authorization tests.
-   Validation tests.
-   Transaction and rollback tests.
-   Concurrency/idempotency tests for consequential operations.
-   Regression tests for existing web workflows.
-   Query/performance checks.

## Android

-   Unit tests for domain logic.
-   Repository tests.
-   ViewModel tests.
-   Serialization/error-mapping tests.
-   API integration tests.
-   Room database tests.
-   WorkManager synchronization tests.
-   Navigation tests.
-   Compose UI tests.
-   Authentication tests.
-   Offline and recovery tests.

## End-to-end

Verify that:

1.  A user signs in through Android.
2.  The user sees only authorized data.
3.  A permitted change from Android is reflected in Laravel.
4.  A change made in Laravel becomes visible in Android after
    refresh/synchronization.
5.  Validation and permissions are consistent.
6.  Network interruption does not silently lose data or create duplicate
    transactions.
7.  Logout and account switching do not leak cached private data.

Run real builds and tests. Record exact commands, results and known
failures.

------------------------------------------------------------------------

# 15. Phase 9 --- Security, performance and release

## Security

Review:

-   Authentication and token lifecycle.
-   Authorization and object-level access.
-   SQL injection and unsafe query construction.
-   Mass assignment.
-   Sensitive data exposure.
-   TLS configuration.
-   File uploads.
-   Rate limiting.
-   Idempotency.
-   Local data protection.
-   Logging and crash reporting.
-   Dependency vulnerabilities.
-   Android exported components and permissions.
-   Backup rules for sensitive local data.
-   Production secrets and signing configuration.

Never put a signing key or production secret in Git.

## Performance

Review:

-   Laravel query count and query plans where useful.
-   API payload size.
-   Pagination.
-   Android startup.
-   Compose recomposition.
-   Main-thread work.
-   Image loading.
-   Local database access.
-   Memory usage.
-   Background work and battery impact.

Optimize measured bottlenecks.

## Production networking

The application must work over Wi-Fi and mobile data.

Document the production requirements:

-   Public domain.
-   Valid HTTPS certificate.
-   Correct web-server/reverse-proxy configuration.
-   Laravel environment configuration.
-   Database backup and migration plan.
-   CORS only if a browser-based client needs it; do not confuse CORS
    with native Android API access.
-   Rate limits and monitoring.
-   Secure file storage.
-   API health checks.
-   Deployment and rollback procedure.

Never use `localhost` or a private LAN IP as the production API address.

## Release deliverables

-   Complete Android source code.
-   Laravel API source changes.
-   Debug APK.
-   Signed release APK or reproducible signing instructions.
-   Build instructions.
-   Installation instructions.
-   Server deployment instructions.
-   API/OpenAPI documentation.
-   Architecture and network reliability documentation.
-   Test and security reports.
-   Known limitations and future improvements.

------------------------------------------------------------------------

------------------------------------------------------------------------

# 16. Phase 10 --- Prepare and deploy for Laravel Cloud

The user has chosen **Laravel Cloud** as the hosting platform. Do not
design this project around a self-managed VPS unless the user later
changes this decision. Laravel Cloud is a managed deployment platform:
follow its current official documentation and dashboard workflow rather
than assuming the user must administer Linux, Nginx, PHP-FPM, SSH,
systemd or firewall rules directly.

The user may add a custom domain later. The application must therefore
work first with the platform-provided deployment hostname, then support
a custom domain without requiring Android source-code changes.

Do not assume the user has created a Laravel Cloud account, project,
environment, database, domain or billing plan. Do not purchase services,
change DNS, access external accounts or deploy to production without the
user's explicit authorization.

## 16.1 Verify Laravel Cloud compatibility and current capabilities

Before changing configuration, inspect the actual Laravel and PHP
versions, Composer dependencies, extensions, database engine, queues,
cache/session drivers, file storage, scheduler, frontend build and
runtime requirements.

Consult the current official Laravel Cloud documentation for supported
runtime versions, deployment configuration, regions, databases,
persistent storage, queues, scheduler, environment variables, health
checks, domains, TLS, backups, limits and pricing. Do not rely on
outdated assumptions or invent feature availability.

Produce a compatibility report that identifies: - Features supported
directly by the selected Cloud environment. - Features requiring an
additional managed resource or service. - Features requiring application
changes. - Plan, region, quota or pricing questions the user must
decide. - Any unsupported dependency or deployment assumption.

Do not add external services merely for fashion. Recommend additional
resources only when the actual application needs them, and explain their
cost/operational trade-offs.

## 16.2 Prepare the Laravel repository for Cloud deployment

Inspect the repository and prepare only changes that are justified by
the real project:

-   Confirm the correct application root and entry point.
-   Confirm Composer dependencies install cleanly in production mode.
-   Confirm frontend assets build reproducibly using the existing
    package manager and lockfile.
-   Identify required PHP extensions and runtime settings.
-   Identify required writable storage/cache paths.
-   Identify whether queues, scheduled commands, persistent files or
    long-running processes are actually used.
-   Ensure application startup and deployment do not depend on a local
    development machine, localhost services or hardcoded LAN addresses.
-   Ensure no local database, test credential or development-only
    service is assumed in production.
-   Keep the existing Laravel web app and Android API on the same
    backend unless a technical reason justifies separation.

Do not replace dependency versions or restructure the app solely to
match a generic deployment tutorial. Preserve lockfiles and existing
business logic.

## 16.3 Cloud environments and deployment workflow

Document a clear workflow for:

1.  Connecting the correct GitHub repository to Laravel Cloud.
2.  Selecting the intended branch and application root.
3.  Creating a non-production/staging environment first, if supported
    and appropriate for the chosen plan.
4.  Selecting a supported PHP runtime and region based on the actual
    project and user requirements.
5.  Configuring build and deployment commands based on the repository.
6.  Setting environment variables through the Cloud dashboard or
    supported secret-management mechanism.
7.  Provisioning and attaching the compatible managed database and any
    required cache, queue or storage resources.
8.  Deploying the staging environment and verifying it.
9.  Reviewing migrations and backups before production migration.
10. Deploying production only after explicit user approval.
11. Verifying health, logs, critical workflows and Android connectivity.

Use current Laravel Cloud terminology and supported configuration
files/features. Do not invent dashboard buttons, commands, YAML keys,
deployment hooks or service settings. Link the relevant official
documentation in the guide.

## 16.4 Production environment and secrets

Prepare a safe `.env.production.example` with variable names and fake
placeholders only. Never commit `.env`, real credentials, API tokens,
private keys or production secrets.

Document the required production variables based on the discovered
application, including where relevant:

-   `APP_ENV=production`, `APP_DEBUG=false`, and the correct `APP_URL`.
-   A securely generated, environment-specific `APP_KEY`.
-   Database connection values supplied by the Cloud-managed database.
-   Cache, session, queue and filesystem settings appropriate to the
    selected Cloud resources.
-   Mail settings only if the application actually sends email.
-   HTTPS-aware proxy and secure-cookie configuration as required by
    Laravel Cloud's current networking model.
-   Any third-party API credentials actually used by the project.

Never copy development credentials or production data into examples.
Never expose secrets in logs, build output, source control or Android
application code. Do not rotate an existing production APP_KEY casually:
explain the impact and require approval before any rotation.

Set production configuration using the platform's supported secure
environment-variable mechanism. Do not assume `.env` is uploaded with
the code.

## 16.5 Domain, platform hostname and HTTPS

The application must initially be testable using the deployment hostname
provided by Laravel Cloud. Later, the user may connect a custom domain,
for example `api.example.com`.

Document the actual current Laravel Cloud steps for: - Adding the chosen
custom domain to the correct Cloud environment. - Creating the exact DNS
records displayed or required by Cloud. - Waiting for and verifying DNS
propagation. - Provisioning and validating HTTPS/TLS. - Confirming
automatic certificate renewal and domain status. - Redirecting HTTP to
HTTPS where supported and appropriate. - Setting the correct Laravel
`APP_URL` and trusted-host behavior.

Do not invent DNS target values, IP addresses, CNAME/A records or
certificate status. Use placeholders until Cloud displays the actual
values. Do not require a custom domain before the user is ready.

## 16.6 Android API endpoint configuration

Configure Android with separate development, staging and production base
URLs using a maintainable build configuration such as Gradle product
flavors or BuildConfig fields.

-   Development must use a local development endpoint only in debug
    builds.
-   Staging must use the actual staging Cloud hostname when configured.
-   Production must use the verified Laravel Cloud hostname initially,
    and the custom HTTPS API domain once the user connects it.
-   Changing from the Cloud hostname to the custom domain must not
    require editing application source code or rebuilding unrelated
    modules; use the selected production build configuration
    deliberately.
-   Never hardcode a VPS IP or a home LAN address as the production URL.
-   Never disable TLS certificate or hostname validation.
-   Never permit cleartext HTTP in release builds.
-   Never embed backend secrets, database credentials or privileged API
    keys in the APK.

Verify the production endpoint externally and test connectivity over
both Wi-Fi and mobile data before release.

## 16.7 Database, migrations and business-data safety

Treat the store's business data as critical.

-   Use a supported managed database resource compatible with the
    discovered Laravel project.
-   Keep database access private and use platform-provided connection
    settings; never expose the database publicly for Android.
-   Use least-privilege database credentials where supported.
-   Review migrations for locks, destructive changes and data loss.
-   Prefer backward-compatible expand/migrate/contract changes when old
    and new application versions may overlap during deployment.
-   Understand the Cloud platform's backup and restore features,
    retention, pricing and limitations from current official
    documentation.
-   Document how to create or verify a backup before schema changes.
-   Document a restore drill in a non-production environment.
-   Never run a production migration, destructive operation or restore
    without explicit user approval and a verified current backup.
-   Never use production data in automated tests.

A backup being created is not proof that it can be restored. Clearly
record whether restore verification has actually succeeded.

## 16.8 Queues, scheduler, storage and background work

Discover which of these features the app actually uses. Configure them
using Laravel Cloud's currently supported mechanisms and resources:

-   Queue workers and failed-job handling.
-   Scheduled tasks and scheduler execution.
-   User-uploaded files and persistent object/file storage.
-   Cache and session storage.
-   Mail delivery.
-   Long-running or background tasks, if any.

Do not assume the application filesystem is persistent across deploys.
Do not store business-critical uploads only in an ephemeral deployment
filesystem. Explain migration steps if the current app stores files
locally and Cloud requires a persistent or object-storage solution.

Do not add Redis or another service unless the selected architecture
requires it. Confirm compatibility and costs before provisioning.

## 16.9 Deployment safety, rollback and observability

Prepare a release and rollback runbook that uses actual Cloud-supported
deployment and rollback capabilities. Include:

-   How Git commits/branches trigger deployments.
-   How to review build and deployment logs.
-   How to identify a failed or unhealthy release.
-   How to roll back application code using supported platform features.
-   How to handle database schema changes that cannot be rolled back
    safely with code alone.
-   How to restart/redeploy workers or other processes if required.
-   How to inspect application logs without exposing sensitive data.
-   How to monitor application health, database capacity, resource
    usage, queues and scheduled tasks where available.
-   How to set up alerts using available platform features or a service
    the user chooses.

Do not claim a rollback restores database state automatically. Do not
create destructive deployment hooks or automatically reset production
data. Deployment and migration steps must fail safely.

## 16.10 Staging and production verification

Use staging before production whenever possible. Execute only tests that
are safe for the environment and mark each result as `Verified`,
`Not verified`, `Blocked` or `Requires user action`.

Verify, when the environment is available:

-   Cloud deployment succeeds from the intended Git branch.
-   The platform hostname resolves and serves the application.
-   The custom domain and HTTPS work after the user configures them.
-   Laravel health checks do not leak debug information.
-   Login, logout, token authentication and authorization work.
-   API resources, pagination, search and validation behave correctly.
-   Sales, stock, purchases and payment workflows preserve transactional
    integrity.
-   Uploads/downloads and persistent storage work securely.
-   Queue and scheduler work if configured.
-   Android release builds use the intended HTTPS endpoint.
-   Android works over Wi-Fi and mobile data.
-   Slow network, timeout, connection-loss and uncertain-write recovery
    tests pass against staging.
-   Database/file backups can be restored in a test environment.
-   No secrets or debug configuration are committed or shipped.

Do not run destructive tests, load tests or simulated payment operations
against production without explicit approval.

## 16.11 Required Laravel Cloud deliverables

Deliver:

-   `LARAVEL_CLOUD_DEPLOYMENT_GUIDE.md` with current official references
    and a step-by-step project-specific deployment workflow.
-   A Cloud compatibility report and list of resources the user must
    provision or select.
-   `.env.production.example` with no real secrets.
-   Staging and production environment configuration instructions.
-   Domain and DNS checklist using placeholders until Cloud supplies
    exact record values.
-   Database migration, backup, restore and recovery runbook.
-   Queue, scheduler and persistent-storage setup instructions if
    needed.
-   Deployment verification, rollback and monitoring checklist.
-   Android development, staging and production endpoint instructions.
-   A final readiness report separating verified items from blocked or
    user-action items.

Prepare everything possible in the repository without external account
access. Do not claim the application is deployed, publicly reachable,
backed up or production-ready until those facts have actually been
verified.

# 17. Phase completion and autonomous workflow

For every phase, follow this exact cycle:

1.  Inspect relevant existing code.
2.  Write or update the implementation plan.
3.  Implement a small coherent set of changes.
4.  Run formatting/static analysis where available.
5.  Run relevant tests.
6.  Build the affected application.
7.  Review the diff.
8.  Fix defects.
9.  Update documentation.
10. Verify acceptance criteria.
11. Mark the phase complete only when evidence supports it.

Proceed to the next phase automatically after the current phase passes
its acceptance criteria, except where this prompt requires user
approval.

At each milestone, report:

-   What changed.
-   Files created/modified.
-   Tests and builds actually executed.
-   Pass/fail results.
-   Known issues.
-   Security implications.
-   Decisions requiring my approval.
-   Next phase.

Do not repeatedly ask permission for routine safe work. Do ask before
destructive, irreversible, costly or business-rule-changing actions.

If blocked by missing credentials or external infrastructure, complete
all work that can safely be completed, document the exact blocker, and
ask only for the required information.

------------------------------------------------------------------------

# 18. Final acceptance criteria

The work is complete only when all applicable criteria are satisfied:

-   Existing Laravel web functionality remains intact.
-   The API is versioned, documented, tested and secure.
-   Existing business logic is reused rather than duplicated.
-   Authorization is enforced server-side.
-   Android is a real native Kotlin application.
-   Android uses the real Laravel API and database-backed data.
-   Required business modules are implemented.
-   Search, filtering and pagination work correctly.
-   Slow networks and connection loss are handled gracefully.
-   Retry behavior is bounded and safe.
-   Consequential writes are protected against duplicate execution.
-   Offline behavior is explicit and does not misrepresent stale data.
-   Pending operations survive process death when offline queuing is
    supported.
-   Android and Laravel remain consistent.
-   Critical tests pass.
-   No known unresolved critical security issue remains.
-   Production HTTPS configuration is documented and verified.
-   Laravel Cloud deployment instructions are complete and reproducible
    for the discovered application.
-   Production environment examples contain no real secrets.
-   Cloud environment variables, domain, HTTPS, backups, restore,
    monitoring and rollback procedures are documented.
-   Production Android builds use only the verified HTTPS API hostname.
-   Deployment readiness is reported honestly; unverified infrastructure
    is never described as deployed.
-   A release APK can be built and installed.
-   Complete source code and deployment documentation are delivered.

Do not call the application production-ready merely because it builds.

------------------------------------------------------------------------

# 19. Begin now

Start with **Phase 0: read-only investigation**.

Do not create the Android project yet. Do not change Laravel logic yet.

First inspect the actual `Store_Managment` repository and understand its
business workflows, data model, authentication, roles and permissions.

Then deliver the audit, feature matrix, API design, network reliability
design and phased implementation plan.

Stop for review at the end of Phase 0.

After the plan is approved, proceed through the phases in order.
Complete Phase 10 by preparing the project and documentation for the
user's VPS and domain deployment. Do not attempt to purchase a VPS,
change DNS, access external accounts or deploy to production without the
user's explicit authorization and the required credentials. Preserve the
existing application, test every meaningful change, and prioritize data
integrity, reliable behavior under poor mobile-network conditions, and
safe production operations over speed.

**The desired result is a maintainable, secure, professional Android
companion to the existing Store_Managment system---not a rushed demo,
not a WebView, and not a second implementation of the business rules.**
