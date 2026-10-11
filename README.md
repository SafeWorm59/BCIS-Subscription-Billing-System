# BCIS Subscription Billing and Collection System

Desktop subscription billing and collection system for Bukidnon Cable and Internet Services. The desktop client is built with Electron, React, and TypeScript; the Fastify API owns authentication, authorization, business operations, and PostgreSQL access; shared API contracts live in `packages/shared`.

## Architecture

```text
Electron renderer -> validated preload IPC -> Electron main -> Fastify REST API -> PostgreSQL
```

The renderer must not connect to PostgreSQL. Business API calls are mediated by a scoped preload bridge and Electron's main process; server permissions remain authoritative. The application includes management for plans, subscribers and service accounts, plus invoice generation, payment recording/history, collections, monthly reports and CSV export. See [docs/architecture.md](docs/architecture.md).

## Prerequisites

- Node.js 22.12 or newer and npm (Electron 44 requirement)
- PostgreSQL 17 or 18 for local database checks and future migrations
- Windows for the primary desktop target; the Electron tooling also retains its other platform build scripts

## Setup

From the repository root:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` and set `DATABASE_URL` to a PostgreSQL database and credentials you have permission to use. `.env` is ignored by Git. No database, user, or schema is created by setup.

## Development

```powershell
npm run dev
```

This starts the API and desktop app together. To run them separately, use `npm run dev:api` and `npm run dev:desktop`. The API binds to `127.0.0.1:3000` by default, and the desktop client currently connects to that loopback address. Remote desktop/API configuration is not provided; do not expose the development service directly to office networks.

The application health endpoint is `GET http://127.0.0.1:3000/api/v1/health`. Database connectivity is checked separately at `GET http://127.0.0.1:3000/api/v1/health/database` or with `npm run db:check`. The application health endpoint does not require a live database connection.

## Checks and Builds

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

Drizzle migration commands are available as `npm run db:generate --workspace=@bcis/api` and `npm run db:migrate --workspace=@bcis/api`. The initial authentication data-model migration is generated but is not applied automatically. Review generated migrations before applying them to any database.

### Isolated PostgreSQL Integration Tests

Integration migrations and tests use only `BCIS_TEST_DATABASE_URL`; these commands do not load `.env` or `.env.example`. The URL is accepted only for database `bcis_subscription_billing_test`, role `bcis_subscription_billing_test`, and host `127.0.0.1`, with an explicit port and password. Set it only after creating the disposable database and role manually. Never point it at a development or production database.

After approval, create the dedicated role/database through an authorized local PostgreSQL administrator session:

```powershell
psql -h 127.0.0.1 -p 5432 -U postgres -d postgres
```

At the `psql` prompt:

```sql
CREATE ROLE bcis_subscription_billing_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password bcis_subscription_billing_test
CREATE DATABASE bcis_subscription_billing_test OWNER bcis_subscription_billing_test;
\q
```

Then run from the repository root in PowerShell, replacing the placeholder with the URL-encoded password for that test role:

```powershell
$env:BCIS_TEST_DATABASE_URL = 'postgresql://bcis_subscription_billing_test:<URL-ENCODED-PASSWORD>@127.0.0.1:5432/bcis_subscription_billing_test'
npm run db:migrate:test --workspace=@bcis/api
npm run test:integration --workspace=@bcis/api
Remove-Item Env:BCIS_TEST_DATABASE_URL
```

The test migration command reuses the tracked Drizzle migrations and does not create/drop the database or role. The integration test checks the authenticated database identity, expected migration tables, and persisted PostgreSQL rate-limit increments.

## Plans, Subscribers, and Service Accounts

The API supports `/api/v1/plans`, `/api/v1/subscribers`, `/api/v1/service-accounts`, `/api/v1/invoices`, `/api/v1/payments`, `/api/v1/billing/summary`, and administrator user/role endpoints. Permissions are enforced by API routes; the development seed grants the defined business and administration permissions to the Administrator role. The renderer uses granted permission keys to show relevant screens and mutation controls.

### Local Development Seed

For a local demonstration, configure `DATABASE_URL` for the development database `bcis_db` and verify the target before applying migrations. From the repository root, set temporary demo Administrator credentials in PowerShell, apply the migrations to that same development database, and explicitly invoke the seed command:

```powershell
$env:BCIS_DEMO_ADMIN_EMAIL = Read-Host 'Demo Administrator email'
$securePassword = Read-Host 'Demo Administrator password' -AsSecureString
$env:BCIS_DEMO_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $securePassword).Password

npm run db:migrate --workspace=@bcis/api
npm run db:seed:dev

Remove-Item Env:BCIS_DEMO_ADMIN_EMAIL, Env:BCIS_DEMO_ADMIN_PASSWORD
Remove-Variable securePassword
```

The seed command refuses any non-loopback target or database other than `bcis_db`, including the integration-test database. It creates the four schema-defined roles and current business and administration permission keys if missing, assigns those permissions to `Administrator`, and links the supplied demo user to that role. It creates the user only when the email is absent; existing user data, passwords, and role assignments are not changed. If the email already exists, the supplied password is not applied, so use the existing account's password and ensure the account is active. The command does not run during API startup and does not create business records.

Plan prices are mutable current values represented as PostgreSQL `numeric(12,2)` and strings at the API boundary. Invoices snapshot account, subscriber, plan, and price information, and payments reference invoices. Plan, subscriber, and service-account deletion is available to their corresponding manage permissions, but PostgreSQL foreign-key restrictions return a conflict for records referenced by accounts or billing history. Plans can also be disabled, and service accounts can be suspended or cancelled. Subscribers have no inactive state in the current schema.

## Application settings and limitations

Settings contains a local payment-confirmation preference, runtime diagnostics, user and role administration (only when granted the corresponding server permissions), and an administrator-only API endpoint editor. API endpoints require HTTPS except loopback HTTP; the candidate must pass `/api/v1/health` before being saved. The setting is stored in the Electron user-data directory, not in the repository. A changed endpoint requires signing in again.

### Database backup and recovery

Install the PostgreSQL 17 command-line tools. On Windows, backup and restore prefer the standard `%ProgramFiles%\\PostgreSQL\\17\\bin` install location; otherwise make `pg_dump` and `pg_restore` available on `PATH`. With `DATABASE_URL` configured in the API environment, run `npm run db:backup --workspace=@bcis/api`. A timestamped custom-format archive is written outside the repository under `%LOCALAPPDATA%\\BCIS\\backups` on Windows or `~/.local/share/BCIS/backups` on other platforms. `BCIS_BACKUP_DIR` can select another absolute directory outside the project. The command checks the archive table of contents after dumping. It does not write to the database.

Restore only during an approved maintenance window after preserving the current database separately: `npm run db:restore --workspace=@bcis/api -- <absolute-path-to-backup.dump>`. The operator must type the exact target database name; restore uses a transaction and cleans matching objects in that database. Verify archives with `pg_restore --list <archive>` and conduct recovery drills only against a separately verified disposable database. Backup and restore commands were implemented but not exercised as part of this change; this repository does not claim a tested recovery point or recovery time. Protect backup files with OS account permissions and off-device retention appropriate to your organization.

The development seed defines the grants needed by the administrator screens in addition to business permissions. Existing databases do not receive grants automatically; update grants only through the approved administrative workflow or an explicitly authorized development seed. No database operations are run automatically by the desktop or API.
