# Security Audit

**Status:** Initial source-based findings only. No penetration test, dependency audit, production review, or deployment verification has been performed.

## Existing controls observed

- Laravel 12 and Sanctum personal access tokens; default configured expiration is 60 minutes.
- Username/password login checks active status, regenerates the session, and rate-limits failed attempts by username/IP.
- Spatie roles/permissions, module view/manage middleware, explicit route gates, and a superadmin-only role assignment path.
- Token abilities and user permissions are both required by `EnsurePagePermission`; role changes revoke personal tokens in the existing flow/tests.
- Stock and wallet writes use database transactions and row locks in existing services; wallet and damaged-stock records use persisted unique idempotency keys.
- Upload processing restricts image MIME formats, dimensions, and memory use, then re-encodes and thumbnails images.
- Laravel's `/up` health route is configured; exception handling returns generic JSON messages for application errors.
- The new `/api/v1` token issue route uses the existing login limiter, rejects inactive users, and creates a personal token with `api:me` plus only currently granted page abilities.
- New product/category/customer/invoice read routes require both the relevant token ability and existing Laravel policy/gate. The API uses explicit resources and bounded pagination rather than raw Eloquent serialization.
- `POST /api/v1/invoices` requires manage permission, uses the existing transactional invoice service, and stores a user/operation/key-scoped payload hash and replay response under a DB unique constraint.
- Customer create/update/delete routes require both the matching manage ability and existing customer gate; customer creation is idempotent under the same user/operation/key scheme.
- Category create/update/delete routes require both the matching manage ability and existing category gate; creation is idempotent, and deletion transactionally detaches related products as the existing web route does.
- The legacy `/api/user` route now checks active-account status; its response remains raw for compatibility and new clients should use `/api/v1/me`.

## Risks to resolve before API release

1. The legacy `GET /api/user` response still serializes a raw Eloquent model. No in-repository clients were found, but external usage must be checked before changing/removing it; use `/api/v1/me` for new clients.
2. Token issue/revoke and the initial versioned read contract are implemented and covered by focused feature tests. Expiration, role revocation, and live authorization still need staging verification.
3. Invoice creation now has DB-backed replay protection, but cashier still uses a short-lived cache marker and installment/supplier/wallet/damaged-stock API writes are not available. Verify simultaneous duplicate handling against the production DB before exposing further write actions.
4. The idempotency response table has no expiry/cleanup; it currently retains result payloads indefinitely. Define retention and privacy controls before production use.
5. `.env.example` contains local HTTP/LAN stateful domains and `SESSION_SECURE_COOKIE=false`. These are development values, not production settings. Production HTTPS, trusted proxy, cookies, secrets, and host rules remain unverified. `.env` secrets were not read or recorded.
6. Local/public filesystem configuration and legacy `public/uploads` may not survive Cloud deployments. Verify persistent/object storage and access control before cloud migration.
7. Backup exports, file upload/download authorization, notification access, and object-level policies need endpoint-specific review. No tenant boundary was identified from the inspected schema.
8. Current `.bat` launch/setup files contain merge-conflict markers; do not run them. The worktree's wallet and migration changes are user-owned and were not altered.

## Verification state

Focused API, existing web-authentication, and invoice/installment/supplier regression tests were run; see `TESTING_REPORT.md`. `RoleAccessTest` currently has 14 failing cases and 6 passing cases, including 403 responses on role routes. No dependency or security scan was run. The local MySQL database and migration state were not queried. Findings remain provisional until full tests and a staging security review.
