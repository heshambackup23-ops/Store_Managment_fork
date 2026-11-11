# Changelog

## Unreleased

- Android: separate "new payment" and "change status" buttons for installments; personal debts ("ديوني") tab inside the installments page with add, edit, pay, details and delete; change-device-status dialog for maintenance; labeled edit/delete buttons for products; edit, change-status (pay in full / refund) and payment buttons for invoices; full damaged-stock page (list, filters, details, add, edit, delete); editable profile including password change; dark-theme toggle removed; all dialog forms scrollable; refreshed card styling.
- Android: live connection indicator (top-bar pill + banner) that checks both the phone's network and the server's `/up` health route, auto-refreshes data when the connection returns; dashboard with quick actions, key figures and alerts; pull-to-refresh; search clear button; back goes to the dashboard first.
- Android fixes: lists no longer blank out while refreshing; confirm buttons are disabled during saves (no double submits); Arabic server validation messages are now shown; lenient JSON decoding for older records.
- Android hardening: product/category cache is replaced atomically (no empty-list flashes) and cache write failures no longer fail a successful request; session token is kept in memory instead of being decrypted from the Keystore on every request; wrong credentials now show "اسم المستخدم أو كلمة المرور غير صحيحة" instead of "session expired"; dashboard figures are computed once per data change and the dashboard no longer refetches five lists on every visit; cancelled requests no longer flip the connection indicator and the health probe retries once before reporting a problem.
- API: `POST /invoices/{invoice}/refund`, `PUT /damaged/{item}` (stock-safe, audited correction), optional password change on `PUT /profile`.


## 2026-11-09

- Added versioned Sanctum token issue/revoke, minimal current-user, and authorized paginated read endpoints for products, categories, customers, and invoices, with focused feature tests and OpenAPI documentation.
- Added DB-backed idempotency and an invoice-create API using the existing transactional service; identical retries replay the original result and changed-payload key reuse conflicts.
- Added permission-gated detail reads for products, categories, customers, and invoices, including stable not-found errors.
- Added authorized customer create/update/delete endpoints, with idempotent create and focused workflow coverage.
- Added authorized category create/update/delete endpoints, preserving the existing product-detach behavior on delete.
- Recorded the Phase 0 repository, business-workflow, authentication, and API audit.
- Added proposed Laravel/Android architecture, network reliability and initial security findings, plus a phased implementation plan.
- No database, migrations, generated output, or dependencies changed.
