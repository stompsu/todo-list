# ToDo Board

A shared ToDo board built with React, TypeScript, Vite, and a .NET 10 Minimal API backed by Azure Cosmos DB for NoSQL. No account is required: **every visitor can read, change, delete, and replace the same board**.

## Local development

Requirements: Node.js 22, npm, and the .NET 10 SDK.

```powershell
npm ci
```

Start the API in a terminal (development-only, nonpersistent memory storage):

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:Storage__Mode = 'InMemory'
dotnet run --project api\TodoBoard.Api --no-launch-profile --urls http://localhost:5080
```

Start the frontend in a second terminal:

```powershell
npm run dev
```

Vite forwards `/api` requests to `http://localhost:5080`. The app opens directly to the board. The memory provider is for local development/tests only; restarting the API clears its board. Never use it as production storage.

To run the checks:

```powershell
dotnet test api\TodoBoard.Api.Tests --configuration Release
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

Playwright starts and stops an isolated development API and Vite server; it never
reuses an existing service. If another application owns IPv4 port 4173, set
`$env:PLAYWRIGHT_VITE_HOST = '::1'` before running browser tests to use IPv6 loopback.
Pointer/touch and viewport tests run on desktop/mobile projects; additional tests
exercise the actual API, two-tab sharing, conflicts, JSON transfer, and reloads.

## Shared data and concurrency

- Cosmos DB is authoritative. There is no offline write synchronization or automatic merging of different browsers' boards.
- A single versioned board document contains tasks and categories. Task array order persists the order within each status column. Task colors remain independent of category.
- Reads return an ETag. Writes require `If-Match`; stale writes fail rather than overwriting someone else's update. The UI surfaces conflicts and failed saves instead of claiming success.
- Changes are refreshed on tab focus and after successful writes; this is not live push collaboration.
- Export downloads validated JSON. Import validates and requires confirmation because it **replaces everyone's shared board**, not just the current browser.
- Existing `todo-board:v1` localStorage data is never automatically uploaded, merged, or deleted. Export a chosen old board and deliberately import that backup into the shared board. Keep the original backup until migration is verified.
- The single-document approach provides atomic replacement but has size and contention limits. The API imposes a limit below Cosmos DB's 2 MB item ceiling; larger or heavily concurrent boards need a per-entity data-model migration.
- Drag handles support pointer, touch, and keyboard movement; status selectors remain an alternative. Clear search/category filters before reordering so the destination order is unambiguous.

### Anonymous-write risk

Anyone who can reach the app can alter or destroy its data. There is no user ownership, private data isolation, or reliable user attribution. Do not store sensitive information. CORS is not authentication. Request validation, rate limiting, managed identity, monitoring, and backups reduce risk but do not protect against a determined anonymous writer.

Use JSON exports before bulk changes, configure Azure budget alerts, monitor Cosmos RU consumption/429 responses and API failures, and practice restoring a backup to a separate environment before replacing production data.

### API contract

| Route | Result |
|---|---|
| `GET /api/health` | API health endpoint |
| `GET /api/board` | Version 1 board JSON and an `ETag` response header |
| `PUT /api/board` | Complete validated board JSON; requires the last read `If-Match` ETag; returns committed board and new ETag |

Missing write preconditions are rejected with HTTP 428; stale preconditions with 412. Do not retry a stale board using a newly fetched token without reviewing/reapplying changes: that would overwrite someone else's data. Invalid data, oversize requests, rate limits, and unavailable storage produce explicit errors.

The JSON shape remains `{"version":1,"categories":[],"tasks":[]}`. Tasks contain `id`, `title`, `description`, nullable `categoryId`, `color` (six-digit hex), and `status` (`todo`, `in-progress`, `completed`). Categories contain `id` and `name`. IDs must be unique within each collection and task category references must exist.

## Azure hosting

The selected architecture is Azure Static Web Apps **Standard**, linked to a Container Apps Consumption API, with Cosmos DB serverless in West Europe. There are no Azure Functions. Cosmos access uses the API host's managed identity, not a database key. The frontend calls same-origin `/api` paths.

The existing SWA Free tier must be upgraded before linking a backend. Standard SWA, a container registry, logging, API compute, and Cosmos usage can incur charges even when the board is small; scale-to-zero can add cold-start latency.

Review [`infra/main.bicep`](infra/main.bicep) and [`infra/main.bicepparam`](infra/main.bicepparam) before any deployment. **No live Azure provisioning, SKU change, or deployment is authorized by local development or validation commands.** Existing Azure resources are not automatically reconciled by application CI.

The [infrastructure runbook](infra/README.md) describes the staged bootstrap, real API image build, deny-by-default ingress setup, supported SWA linking operation, and post-link checks. The [API configuration reference](api/CONFIGURATION.md) lists environment variables, limits, and local Cosmos development. The container uses partition key `/id`, matching the API's `shared-board` document.

### Automatic deployment from `main`

The GitHub Actions workflow at [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml):

- Runs frontend lint, type-checking, unit/component tests, Playwright, production build, .NET build/tests, and Bicep compilation on pull requests targeting `main` and pushes to `main`.
- Deploys the API container and then the frontend only for an explicitly enabled push-to-`main` production deployment after all validation succeeds.
- Uses Azure OIDC for the API deployment and the existing `AZURE_STATIC_WEB_APPS_API_TOKEN` secret for the frontend.

Linked backends are not available in SWA pull-request preview environments. Browser tests use an isolated test board/API fixture rather than production data. Pull requests do not deploy.

Deployment is disabled until repository variable `BACKEND_DEPLOYMENT_ENABLED` is exactly `true`. Both layers are gated: API image update, proxied health and Cosmos board read, direct-origin rejection check, then frontend upload. Do not enable this until resources, SWA Standard linkage, runtime RBAC, and the protected GitHub `production` environment are configured and verified.

Set these GitHub Actions variables (non-secret identifiers): `SWA_NAME`, `AZURE_RESOURCE_GROUP`, `ACR_NAME`, `CONTAINER_APP_NAME`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`. Keep the existing secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. Configure Azure federated credentials for the repository's `production` environment subject, and scoped deployment permissions for ACR builds, Container App image updates, and resource metadata reads. The deployment identity is separate from the runtime identity and must not grant Cosmos data access to the browser. The workflow never creates resources, roles, secrets, or federation.

### Post-deployment verification and rollback

Before enabling production writes, verify `/api/health` and `/api/board` through the SWA hostname, and verify that the Container Apps hostname rejects requests not proxied through SWA. Linking should install the **Azure Static Web Apps (Linked)** identity provider; do not remove it or enable unauthenticated direct API ingress as a workaround.

Use two browser sessions to verify shared CRUD, stale-write conflicts, category deletion preserving tasks, order/status persistence after reload, and explicit import confirmation. Check mobile/touch and keyboard drag behavior. Confirm the production API is configured for Cosmos, not the development memory store.

Keep the previous container image tag and a JSON board export before releasing. If a release fails, restore the previous API image and matching frontend revision; do not clear Cosmos or reset the board as a deployment recovery step. Restore data only after reviewing a backup and explicitly confirming replacement. Budget alerts and logs are operational controls, not spending caps or data backups.
