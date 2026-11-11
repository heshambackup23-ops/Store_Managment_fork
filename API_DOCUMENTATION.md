# API Documentation

**Version:** v1  
**Base path:** `/api/v1`  
**Status:** Authentication, list/detail reads, customer/category/product/supplier creation, standalone catalog or custom-total installment creation, wallet creation and balance management, user-scoped notifications, and invoice creation are implemented. Other write workflows remain permission-gated and limited to the documented operations.

## Authentication

`POST /auth/token` accepts `username`, `password`, and a caller-chosen `device_name` (1-80 characters). Usernames are trimmed and lowercased. The existing login limiter applies per username and IP. Credentials for missing, inactive, or password-mismatched accounts receive the same `401 AUTHENTICATION_FAILED` response.

Successful issuance returns `201` with a one-time `access_token`, `token_type: Bearer`, configured expiration, and a minimal user object. Store the token as a secret. The token receives `api:me` and only the `page.<module>.view/manage` abilities allowed by the user's current permissions. Each protected data endpoint also checks the actual Laravel policy/gate, so token abilities never grant a permission the user does not have.

Send the token as `Authorization: Bearer <token>`. `DELETE /auth/token` revokes only the current personal access token and returns `204`. `GET /me` requires `api:me` and returns only `id`, `name`, `username`, current role names, and current page permissions. Disabled accounts are rejected by the active-user middleware.

## Endpoints

| Method and path | Required ability and authorization | Query/body | Result |
| --- | --- | --- | --- |
| `POST /auth/token` | No token; existing login throttle | JSON: `username`, `password`, `device_name` | `201` token and minimal user; generic `401` on invalid/inactive credentials |
| `DELETE /auth/token` | Any authenticated active personal token | None | `204`; revokes current token only |
| `GET /me` | `api:me` | None | Minimal current-user resource |
| `GET /products` | `page.products.view` ability and `view-products` gate | `q`, `category_id`, `in_stock`, `page`, `per_page` | Product resources with category; ordered by descending ID |
| `POST /products` | `page.products.manage` ability and `create-products` gate | JSON name, price, description, stock, optional barcode/category, required `Idempotency-Key` | `201` product resource; identical retries replay |
| `GET /products/{product}` | `page.products.view` ability and `view-products` gate | Numeric product ID | Product resource with category |
| `GET /categories` | `page.categories.view` ability and `view-category` gate | `q`, `page`, `per_page` | Category resources; ordered by name then ID |
| `GET /categories/{category}` | `page.categories.view` ability and `view-category` gate | Numeric category ID | Category resource with product count |
| `POST /categories` | `page.categories.manage` ability and `create-category` gate | JSON `name`, required `Idempotency-Key` header | `201` category resource; identical retries replay |
| `PUT /categories/{category}` | `page.categories.manage` ability and `update-category` gate | JSON `name` | Updated category resource |
| `DELETE /categories/{category}` | `page.categories.manage` ability and `delete-category` gate | Numeric category ID | `204`; products are detached from the deleted category |
| `GET /customers` | `page.customers.view` ability and `view-customers` gate | `q`, `page`, `per_page` | Customer identity/contact resources; descending ID |
| `GET /customers/{customer}` | `page.customers.view` ability and `view-customers` gate | Numeric customer ID | Customer identity/contact resource |
| `POST /customers` | `page.customers.manage` ability and `create-customers` gate | JSON `name`, `phone`, `address`, required `Idempotency-Key` header | `201` customer resource; identical retries replay |
| `PUT /customers/{customer}` | `page.customers.manage` ability and `update-customers` gate | JSON `name`, `phone`, `address` | Updated customer resource |
| `DELETE /customers/{customer}` | `page.customers.manage` ability and `delete-customers` gate | Numeric customer ID | `204`; existing installment snapshots are preserved |
| `GET /invoices` | `page.invoices.view` ability and `view-invoice` gate | `q`, `page`, `per_page` | Invoice snapshots and server-recorded totals; descending ID |
| `GET /invoices/{invoice}` | `page.invoices.view` ability and `view-invoice` gate | Numeric invoice ID | Invoice snapshot, items, and server-recorded totals |
| `POST /invoices/{invoice}/pay` | `page.invoices.manage` ability and `create-invoice` gate | Optional partial amount and required `Idempotency-Key` | `200` updated invoice; omitted amount pays the remaining balance and synchronizes its installment |
| `POST /invoices/{invoice}/refund` | `page.invoices.manage` ability and `update-invoice` gate | Required `Idempotency-Key` | `200` refunded invoice; sold units return to stock and linked installments are closed |
| `PUT /damaged/{item}` | `page.damaged.manage` ability | `quantity`, `reason`, optional `unit_value`, `damaged_on`, `notes`, required `Idempotency-Key` | `200` corrected record; the stock difference is applied to the product and audited (`damaged.updated`); voided records cannot be edited |
| `PUT /profile` (optional fields) | authenticated user | `current_password`, `password`, `password_confirmation` | Changes the password when supplied; `current_password` is required with `password` |
| `GET /cashier/products` | `page.invoices.manage` ability and `create-invoice` gate | Optional `q` | Top sellers or name/barcode matches, with exact barcode matches prioritized |
| `POST /cashier/checkout` | `page.invoices.manage` ability and `create-invoice` gate | JSON items, optional customer/received amount, required `Idempotency-Key` | `201` invoice totals and change; server checks current prices/stock and safely replays retries |
| `GET /sales` | `page.sales.view` ability and current `page.sales.view` permission | `q`, `page`, `per_page` | Read-only sold-product totals from `products.total_sold`, matching the Laravel report |
| `GET /maintenance` | `page.maintenance.view` ability and current `page.maintenance.view` permission | `q`, `page`, `per_page` | Maintenance requests with status, dates, and contact details; notes and image paths are omitted |
| `GET /maintenance/{maintenance}` | `page.maintenance.view` ability and current `page.maintenance.view` permission | Numeric maintenance ID | Allowlisted maintenance request details |
| `POST /maintenance` | `page.maintenance.manage` ability and current `page.maintenance.manage` permission | JSON name, owner, status, requested date, optional phone/address/description, required `Idempotency-Key` | `201` maintenance resource; identical retries replay |
| `PUT /maintenance/{maintenance}` | `page.maintenance.manage` ability and current `page.maintenance.manage` permission | Maintenance fields; optional phone/address/description | Updated maintenance resource; completion date follows status |
| `DELETE /maintenance/{maintenance}` | `page.maintenance.manage` ability and current `page.maintenance.manage` permission | Numeric maintenance ID | `204`; associated image file is removed |
| `GET /installments` | `page.installments.view` ability and `view-installments` gate | `q`, `page`, `per_page` | Customer/product snapshots, installment balances, dates, status, and item snapshot; notes are omitted |
| `GET /installments/{installment}` | `page.installments.view` ability and `view-installments` gate | Numeric installment ID | Allowlisted installment snapshot and server-recorded balances |
| `POST /installments` | `page.installments.manage` ability and `create-installments` gate | JSON customer and paid amount, plus either product IDs/quantities or custom product name/total; optional dates/notes and required `Idempotency-Key` | `201` standalone debt resource; catalog prices are read from Laravel and stock is unchanged |
| `PUT /installments/{installment}` | `page.installments.manage` ability and `update-installments` gate | Same catalog or custom-total fields and required `Idempotency-Key` | `200` updated standalone installment; invoice-linked installments must be edited through their invoice |
| `POST /installments/{installment}/pay` | `page.installments.manage` ability and `update-installments` gate | Optional partial amount and required `Idempotency-Key` | `200` updated installment; omitted amount pays the remaining balance, including linked invoice totals |
| `DELETE /installments/{installment}` | `page.installments.manage` ability and `delete-installments` gate | Required `Idempotency-Key` | `204` standalone installment deleted; invoice-linked installments cannot be deleted |
| `GET /suppliers` | `page.suppliers.view` ability and current `page.suppliers.view` permission | `q`, `page`, `per_page` | Allowlisted supplier contact/payable summary with purchase count; ordered by balance then name |
| `GET /suppliers/{supplier}` | `page.suppliers.view` ability and current `page.suppliers.view` permission | Numeric supplier ID | Allowlisted supplier contact/payable summary; internal notes and payment records are not included |
| `POST /suppliers` | `page.suppliers.manage` ability and current `page.suppliers.manage` permission | JSON name and optional contact/address/opening balance/notes, required `Idempotency-Key` | `201` supplier resource; opening balance initializes the payable balance |
| `GET /wallets` | `page.wallets.view` ability and current `page.wallets.view` permission | None | Ledger summary and allowlisted wallet balances/limit usage; notes and transaction records are omitted |
| `POST /wallets` | `page.wallets.manage` ability and current `page.wallets.manage` permission | JSON name/provider/opening balance, optional identifier, required `Idempotency-Key` | `201` wallet ID; opening balance is recorded through wallet creation workflow |
| `POST /wallets/{wallet}/adjust` | `page.wallets.manage` ability and current `page.wallets.manage` permission | JSON nonzero signed amount and reason, required `Idempotency-Key` | `201` ledger transaction ID; balance changes are audited and cannot become negative |
| `POST /wallets/{wallet}/toggle` | `page.wallets.manage` ability and current `page.wallets.manage` permission | Required `Idempotency-Key` | `200` wallet ID and updated active state; change is audited |
| `GET /wallet-cashier` | `page.wallet_cashier.view` ability and current `page.wallet_cashier.view` permission | None | Active wallets, recent transactions, and total outstanding amount |
| `POST /wallet-cashier` | `page.wallet_cashier.manage` ability and current `page.wallet_cashier.manage` permission | JSON wallet, type, amount, counterparty and optional commission/fee/payment/customer/notes; required `Idempotency-Key` | `201` ledger transaction; balance, cash, limits, and audit are updated transactionally |
| `POST /wallet-cashier/{transaction}/settle` | `page.wallet_cashier.manage` ability and current `page.wallet_cashier.manage` permission | Optional partial amount; required `Idempotency-Key` | `201` settlement ledger row; omitted amount collects the full receivable |
| `POST /wallet-cashier/{transaction}/reverse` | `page.wallets.manage` ability and current `page.wallets.manage` permission | Required reason and `Idempotency-Key` | `201` reversal ledger row; original financial rows are never deleted |
| `GET /notifications` | `page.notifications.view` ability and current `page.notifications.view` permission | `page`, `per_page` | Active notifications with read state scoped to the current user |
| `POST /notifications/{notification}/read` | `page.notifications.view` ability and current `page.notifications.view` permission | Numeric notification ID | `204`; marks the active notification read for the current user |
| `POST /notifications/read-all` | `page.notifications.view` ability and current `page.notifications.view` permission | None | `204`; marks all currently active notifications read for the current user |
| `POST /invoices` | `page.invoices.manage` ability and `create-invoice` gate | JSON invoice fields and required `Idempotency-Key` header | `201` invoice resource; safely replays an identical request |

Search is a literal substring search; `%` and `_` are escaped rather than treated as client-supplied SQL wildcards. Product search matches name or barcode, customer search matches name or phone, installment search matches customer or product snapshot, supplier search matches name, phone, or email, and invoice search matches customer or invoice number. `per_page` defaults to 20 and is limited to 100. Pagination uses Laravel's `data`, `links`, and `meta` envelope.

`in_stock=true` returns stock greater than zero; `in_stock=false` returns stock at or below zero. Invalid boolean values fail validation. Product prices and invoice monetary values are decimal strings with two digits; cached values are not authoritative for writes.

## Errors

Validation errors return `422`:

```json
{
  "message": "The given data was invalid.",
  "error_code": "VALIDATION_FAILED",
  "errors": { "field": ["A validation message."] }
}
```

Authentication, permission, not-found, conflict, rate-limit, and server failures use generic messages with stable codes such as `AUTHENTICATION_REQUIRED`, `PERMISSION_DENIED`, `RESOURCE_NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_SERVER_ERROR`, and `SERVICE_UNAVAILABLE`. Token credential failure uses `AUTHENTICATION_FAILED`. Do not parse localized validation text as a programmatic code.

## Compatibility endpoint

The legacy `GET /api/user` route remains unchanged in response shape for compatibility and now rejects inactive accounts. It still serializes the legacy user model directly; new clients must use `/api/v1/me`. Remove or migrate the compatibility route only after external-client usage is confirmed.

## Invoice Creation and Idempotency

`POST /invoices` accepts the existing invoice workflow fields: `customer`, `product_ids`, `quantities`, `invoice_date`, `paid_amount`, and optional `notes`. Prices, line totals, invoice number, stock, and installment state are computed by Laravel's existing `InvoiceCreationService` and `InvoiceInstallmentSync`; client-supplied prices or totals are not accepted.

Send a stable `Idempotency-Key` header (16-64 alphanumeric/hyphen characters; a UUID is recommended) for each logical invoice operation. Laravel stores a payload hash, operation, user, status, and response under a database unique constraint in the same outer transaction as invoice creation. An identical replay returns the original response; reuse with a different payload returns `409 IDEMPOTENCY_KEY_REUSED`. Validation/business failures roll back the idempotency record, so the caller may correct the request and retry. Records currently have no automatic expiry or cleanup and are retained indefinitely.

The unique constraint is intended to serialize concurrent duplicates, but simultaneous-request behavior still needs verification on the production database engine. Only sequential replay, mismatch, and rollback behavior have been exercised in the SQLite test suite. Do not run this migration against production without the required backup/schema review and explicit authorization.

Customer, category, product, supplier, wallet, maintenance, wallet-cashier, and standalone installment creation use durable idempotency keys under separate operation names. Custom installments accept `product_name` and `total_amount`; catalog installments snapshot current database product prices. Both leave stock unchanged and synchronize the customer ledger and notification in the same transaction. Wallet adjustments and activation changes are audited, and cashier corrections use reversals rather than modifying or deleting ledger rows. Customer phone/address, product description/barcode, and maintenance contact/description fields may be null; business-required names, prices, dates, and transaction amounts remain required. Customer duplicate-name behavior follows the existing workflow; the database does not impose a unique name/phone rule.

## Not Yet Available

Installment update/deletion/payment, supplier purchase/payment, wallet expenses/cash-drawer operations, damaged-stock writes, admin notification creation/deletion, invoice update/refund/delete, and offline-write APIs are not enabled. Wallet transaction rows are append-only and cannot be edited or deleted; corrections use reversals. No registration, password-reset, or payment-provider endpoint is provided.

The machine-readable initial contract is in [`openapi.yaml`](openapi.yaml).
