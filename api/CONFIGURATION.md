# Shared board API

.NET 10 Minimal API, anonymous by design. Calls from the browser use the Static Web Apps
`/api` proxy to the Container Apps host. No browser configuration needs Cosmos settings.

## Contract and persistence

- `GET /api/health`: liveness only; does not contact Cosmos or establish storage readiness.
- `GET /api/board`: version 1 board JSON and a strong `ETag`.
- `PUT /api/board`: complete replacement; requires that exact strong ETag in `If-Match`.
  Returns the committed board and new ETag. Missing precondition: 428; stale precondition:
  412; invalid/wildcard/weak/multiple tags: 400.
- Before the first save, GET returns an empty board with ETag `"empty"`. That token
  permits **create only**; concurrent first saves cannot overwrite each other.
- The stored document is `{"id":"shared-board","version":1,"categories":[],"tasks":[]}`.
  The existing container must use partition key `/id`. Metadata is not returned to clients.
  Task array order, status values, nullable category references, category names, text,
  and task colors are preserved. No normalization, merging, sorting, or implicit import occurs.
- Duplicate IDs within each collection, dangling category references, null required fields,
  unknown/duplicate JSON properties, missing properties, wrong types, and unsupported
  versions are rejected. Duplicate category **names** are permitted, matching import.
- Errors use Problem Details. Invalid data: 400; non-JSON: 415; size: 413; rate limit:
  429 with `Retry-After`; unavailable/throttled/denied storage: 503 with `Retry-After`;
  corrupt stored data or unexpected failure: 500. Storage failures are logged and never
  silently replaced with a fresh board. A missing container/database is not an empty board.
- A failed/timed-out write may have committed; the API does not claim either success or
  definite non-commit. Reload and review before retrying. Never blindly retry stale data
  with a fresh ETag.

## Limits

| Limit | Value |
|---|---:|
| PUT body, including whitespace (Content-Length or streamed) | 1,000,000 bytes |
| Serialized document, including `id`, before Cosmos system properties | 1,500,000 bytes |
| Categories | 200 |
| Tasks | 2,000 |
| ID length | 100 UTF-16 code units |
| Category name | 40 UTF-16 code units |
| Task title | 120 UTF-16 code units |
| Task description | 1,000 UTF-16 code units |
| Returned validation-error keys | 25 |
| JSON nesting | 8 |

Color must be exactly `#RRGGBB`. Status is `todo`, `in-progress`, or `completed`.
Serialized size is checked separately: escaping can expand an otherwise acceptable request.
Cosmos SDK requests use a 10-second request timeout, bounded 429 retries (3 retries,
5 seconds maximum retry wait), and a 30-second cancellation deadline per repository
storage operation. A missing-item check can also perform a container metadata read.

## Environment configuration

| Environment key | Default / purpose |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production`; only `Development` permits memory |
| `Storage__Mode` | `Cosmos`; `InMemory` is explicit and Development-only |
| `Cosmos__Endpoint` | Required absolute HTTPS account URI for Cosmos mode |
| `Cosmos__Database` | Required existing database name |
| `Cosmos__Container` | Required existing container name, partition key `/id` |
| `AZURE_CLIENT_ID` | Optional user-assigned managed identity client ID; otherwise system-assigned |
| `ASPNETCORE_HTTP_PORTS` | Dockerfile sets `8080` |
| `RateLimiting__WindowSeconds` | `60` |
| `RateLimiting__ReadsPerClient` | `120` |
| `RateLimiting__ReadsGlobal` | `1200` |
| `RateLimiting__WritesPerClient` | `30` |
| `RateLimiting__WritesGlobal` | `300` |
| `ForwardedHeaders__KnownProxies__0` (and numbered entries) | Explicit trusted ingress proxy IPs; framework loopback defaults remain |
| `Logging__LogLevel__Default` | `Information` |
| `Logging__LogLevel__Microsoft.AspNetCore` | `Warning` |

Production uses `ManagedIdentityCredential` only; no secrets, keys, or connection strings.
Development Cosmos uses `DefaultAzureCredential` for local developer sign-in. There is no
storage fallback and no database/container creation. The host identity needs Cosmos data-plane
permissions to read container metadata and read/create/replace the shared item.

Forwarded headers are accepted for one hop only from known proxies. Configure the actual
ingress addresses rather than trusting client-supplied `X-Forwarded-For`. Without that
configuration, callers behind ingress may share a rate-limit bucket. Rate limits are
**per API process**, not a distributed spending cap; scaling multiplies global limits.
Health is exempt. Anonymous writers can still erase the board. CORS and rate limiting are
not authentication. SWA linkage/direct-origin ingress protection is a hosting responsibility,
not implemented as a spoofable header check in this API.

## Local commands (PowerShell, repository root)

```powershell
dotnet test api\TodoBoard.Api.Tests --configuration Release
dotnet test api\TodoBoard.Api.Tests --configuration Release --blame-hang-timeout 60s --disable-build-servers
dotnet publish api\TodoBoard.Api --configuration Release --no-restore /p:UseAppHost=false
dotnet run --project api\TodoBoard.Api --launch-profile InMemory
```

Or explicitly configure local storage without launch profiles:

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:Storage__Mode = 'InMemory'
dotnet run --project api\TodoBoard.Api --no-launch-profile --urls http://localhost:5080
```

Memory data is process-local, nonpersistent, and intentionally unavailable outside Development.

Docker build context is **api**, not the repository root:

```powershell
docker build --file api\Dockerfile --tag todo-board-api:local api
```

The final .NET 10 runtime image listens on port 8080 as its built-in nonroot `APP_UID`.
It defaults to Production/Cosmos and requires runtime environment configuration to start.
Building the image does not provision or deploy anything.

Tests host the real HTTP pipeline using TestServer and exercise the Cosmos repository
through substituted SDK calls. They do not prove live Cosmos RBAC, network connectivity,
or Azure proxy behavior. Live-service and container smoke tests require their respective
tools/environments and separate authorization; no live Azure changes are needed or performed.
