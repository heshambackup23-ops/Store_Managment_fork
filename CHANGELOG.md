# Changelog

## 2026-11-09

- Added versioned Sanctum token issue/revoke, minimal current-user, and authorized paginated read endpoints for products, categories, customers, and invoices, with focused feature tests and OpenAPI documentation.
- Added DB-backed idempotency and an invoice-create API using the existing transactional service; identical retries replay the original result and changed-payload key reuse conflicts.
- Added permission-gated detail reads for products, categories, customers, and invoices, including stable not-found errors.
- Added authorized customer create/update/delete endpoints, with idempotent create and focused workflow coverage.
- Added authorized category create/update/delete endpoints, preserving the existing product-detach behavior on delete.
- Recorded the Phase 0 repository, business-workflow, authentication, and API audit.
- Added proposed Laravel/Android architecture, network reliability and initial security findings, plus a phased implementation plan.
- No database, migrations, generated output, or dependencies changed.
