# Network Reliability Design

**Status:** Android network and cache foundation implemented; resilience/device testing remains pending.

## Data authority and cache

Room is the local product/category read cache observed by the UI. Repositories expose `Flow`/`StateFlow`; Compose and ViewModels call repositories rather than Retrofit directly. Product and category lists refresh from the API and retain cached content on failure. Product price/stock are labeled informational and show a last-updated time. Customer and invoice lists remain online-only. Account changes/logout clear private catalog cache.

Cached stock, product price, invoice balance, installment due, supplier balance, wallet balance, and payment status are informational only when stale. Never permit them to authorize a final operation or present them as confirmed current values. Sensitive business cache must be scoped to the signed-in user and cleared on logout/account switch; decide retention and Android backup exclusions before implementation.

## Writes and uncertain outcomes

Sales/invoices, stock changes, installment payments, supplier payments, and wallet movements require live Laravel validation. Offline mode may preserve an explicit draft, but must not claim the operation succeeded or enqueue finalization without business approval.

Before a consequential mobile write is enabled, Laravel needs a durable idempotency record scoped to user and operation, a payload fingerprint, unique database constraint, replay of the original result, rejection of key reuse with a changed payload, and a result lookup/reconciliation path. Android creates one UUID per logical operation and keeps that same key through retries. A timeout after submit means **unknown outcome**, not success or definite failure. Never retry a consequential write with a new key.

The Android invoice-create form sends an `Idempotency-Key` header and keeps the key stable for unchanged retries. Laravel stores the original response and payload hash in the same database transaction. An identical retry replays the original response; changed-payload key reuse conflicts. Simultaneous duplicate requests still need testing on the target production database engine. Idempotency records currently have no expiration/cleanup policy.

Existing cashier cache idempotency is temporary and should not be treated as sufficient for a disconnected mobile client. Existing persisted wallet/damaged-stock idempotency is useful precedent, not a substitute for testing the full API contract.

## Retry and error policy

- The Android OkHttp client currently disables automatic connection retries and does not add repository-level retries; users can explicitly refresh safe reads.
- Handle 429 using `Retry-After` when supplied. Do not retry validation/authorization 4xx responses or loop on 401.
- Retry writes only with an unchanged idempotency key and only after server-side protections are verified.
- Avoid stacking uncontrolled retries in OkHttp, repositories, and WorkManager.
- Map offline/DNS/connect/read timeout/reset/TLS, HTTP 401/403/404/409/422/429/5xx, malformed response, local storage failure, and unknown outcomes into typed states with clear recovery actions. Never display raw server pages or exception messages.
- TLS certificate and hostname validation remain enabled in every build; no production cleartext or permissive trust manager.

## Connectivity, pagination, and background work

Connectivity APIs may inform UI but do not prove the API is reachable. The request outcome is authoritative. Preserve displayed cached data and form drafts across disconnects; stop indefinite loading and offer safe refresh/retry. Debounce search, cancel stale requests, and use deterministic server pagination. Preserve loaded rows if the next page fails.

Use WorkManager only for operations explicitly approved to queue. Persist an operation UUID, schema version, user/account identity, creation time, state, and protected payload. Keep credentials out of queued data. Ensure duplicate workers cannot apply an operation twice, expose pending/failed/conflict states, survive process death/restart, and define account-switch behavior. Financial and stock-changing workflows remain online-only by default.

## Verification plan

Before release, test airplane mode, captive/no-internet Wi-Fi, high latency, DNS failure, TLS failure, connection loss before/during/after writes, 429/5xx, token expiration, pagination/search races, process death with approved work, device restart, repeated sync, and simultaneous edits on two devices. Use staging and controlled fixtures; do not run destructive or simulated payment tests against production.
