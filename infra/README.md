# Shared ToDo infrastructure — authoring only

**No resources have been deployed by this change.** All commands below that contact
Azure are a future operator runbook, not permission to execute them. Obtain explicit
authorization for provisioning, the **Free → Standard** SWA change, image build,
linking/authentication changes, and live checks. No login UI or Azure Functions.

## API storage contract

The container uses partition path **`/id`**, matching the API's single document
`id` of `shared-board` and its read/create/replace partition-key value. Metadata
is not returned to browser clients. Cosmos partition paths cannot be changed
in place; an existing container with a different path requires a separately
approved migration/new container, never destructive replacement.

## Files and parameters

| File | Purpose |
| --- | --- |
| `main.bicep` | Bootstrap resources, RBAC, optional API module, outputs |
| `static-web-app.bicep` | Standard SKU PUT for the exact existing SWA |
| `api.bicep` | Private ACR image, UAMI, port 8080, scaling, initial backend auth |
| `main.bicepparam` | Approved dev target, bootstrap only |

Deploy at resource-group scope in **`rg-todolist-dev`**. The resource group is
assumed to exist and is not created by this template.

| Parameters | Defaults / meaning |
| --- | --- |
| `location` | `westeurope`, ACA/ACR/Cosmos/identity/logs |
| `staticWebAppName` | `todo-board-dev-20261104-1046` — existing resource, keep exact |
| `staticWebAppResourceGroup` | `rg-todolist-dev`; supports an explicitly selected existing SWA RG |
| `staticWebAppLocation` | `westeurope`; must match the existing site |
| `upgradeStaticWebApp` | `true`: a deployment manages Standard; `false`: reference only, does not downgrade |
| `namePrefix` | `todo-board-dev`; stable naming seed |
| `registryName`, `cosmosAccountName` | Globally unique deterministic names derived from RG ID; override if occupied |
| `identityName`, `environmentName`, `apiName`, `workspaceName` | Stable prefix-derived names; overridable |
| `databaseName`, `containerName` | `todo`, `boards`; path is fixed `/id` |
| `deployApi`, `apiImage` | `false`, empty; opt in with a real `<registry>.azurecr.io/<repo>@sha256:<digest>` or immutable tag |
| `enableApiIngress` | `false`: environment-only ingress until auth exists; true permits external routing, still requires backend auth |
| `initializeBackendAuth` | `true`: install deny-all auth; set false after portal linkage to preserve its provider |
| `maxReplicas` | `2`, allowed 1–5; min is fixed 0 |
| `logRetentionDays`, `tags` | 30 (range 30–730), application/environment tags |

ARM resource declarations are create-or-update, **not update-only**. The `existing`
reference does not prevent the SWA module from creating a mistyped name. An operator
must verify exact resource ID, RG, location, current SKU, and existing repository/
branch/build configuration before approving the Standard PUT. Do not select a new
name or region to "upgrade". Review the planned change and preserve the existing
frontend/source-control binding; this template deliberately supplies no repository
token or source-control settings. If the service would reset existing settings,
stop and adapt the template with approved, non-secret configuration before deployment.
Changing names creates additional resources; it does not rename existing resources.

## Resources, identity, backup, monitoring

- SWA Standard is fixed; changing SKUs requires separate explicit authorization.
- ACR Basic, admin credentials disabled. UAMI gets **AcrPull only on this registry**.
  Registry uses classic RBAC, not ABAC repository roles. The build operator has
  separate approved ACR build/push rights; the runtime identity cannot push.
- ACA Consumption workload profile, .NET 10 image built from `api/Dockerfile` with
  **`api` as build context**, 0.25 vCPU / 0.5 GiB, HTTP scaling 0–2 by default.
  Scale-to-zero/cold starts and SWA backend timeouts must be assessed after approval.
- UAMI is attached to the API and selected by `AZURE_CLIENT_ID`. Production storage
  uses `ManagedIdentityCredential`, not developer or environment-secret fallback.
  Env keys: `Storage__Mode=Cosmos`, `Cosmos__Endpoint`, `Cosmos__Database`,
  `Cosmos__Container`, `ASPNETCORE_HTTP_PORTS=8080`, Production environment.
- Cosmos NoSQL serverless, one region, no RU/s/throughput settings. Local key auth
  disabled. Custom data-plane role permits metadata plus item read/create/replace;
  assignment is scoped to the **single container**, not database/account. No delete,
  query, wildcard contributor, or management-plane permissions for the runtime.
  SDK metadata discovery and role propagation need real integration verification.
- Periodic backups: 4-hour interval, 24-hour retention, local redundancy. These are
  serverless-compatible periodic settings; this is **not continuous PITR**.
  Restore procedures, retention/RPO/RTO and restore destination require an approved
  exercise; no backup restore has been attempted.
- Log Analytics (PerGB2018) receives ACA console/system logs. Cosmos request logs
  and request metrics are routed there. Azure platform metrics remain available.
  Transport probes check listening port only, **not database readiness**;
  `/api/health` is also not a Cosmos success check. No alert/action-group recipient
  is invented; define alert thresholds, budget and approved recipients before release.
- No credentials in parameters, image configuration or outputs. The environment
  integration obtains a Log Analytics shared key with ARM `listKeys()` at deployment
  time; it is never output or persisted in source. This platform logging integration
  does not alter keyless API-to-Cosmos or identity-based ACR pulls.
- Public service endpoints are used for ACR/Cosmos with identity authorization;
  there are no private endpoints/VNet isolation guarantees. Do not mistake CORS,
  a secret URL, an `Origin` header, or a spoofable identity header for backend auth.
  Region availability, quotas and SKU compatibility are not checked locally.

## Future authorized operator sequence

**Not executed.** Run commands from repository root in PowerShell, with bounded CLI/
job timeouts appropriate to the organization. Inspect existing resources and the
deployment plan first; do not run a deployment merely to validate syntax.

1. Verify the selected subscription and existing resource group/SWA using authorized
   read-only tooling. Check `todo-board-dev-20261104-1046` is the intended Free site
   in West Europe. Obtain explicit cost/SKU approval. Retain the same parameters for
   every stage; use incremental mode, never complete mode for this shared group.
2. **Bootstrap** — identity, ACR, Cosmos DB/container/RBAC, logs, ACA environment,
   and existing SWA Standard, with **no app and no placeholder image**:

   ```powershell
   $az = 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'
   & $az deployment group create --resource-group rg-todolist-dev `
     --name todo-bootstrap --mode Incremental --parameters infra/main.bicepparam
   ```

3. Capture bootstrap outputs (non-secret). Build/push the actual image.
   Building remotely is an Azure write and needs
   approval. Use a unique commit-derived tag; preferably resolve and pin its digest:

   ```powershell
   $registry = '<registryName output>'
   $tag = '<unique-commit-tag>'
   & $az acr build --registry $registry --image "todo-api:$tag" `
     --file api/Dockerfile --timeout 1200 api
   $image = '<registryLoginServer output>/todo-api@sha256:<built-digest>'
   ```

4. **Second deployment** — actual API, environment-only ingress, deny-all auth:

   ```powershell
   & $az deployment group create --resource-group rg-todolist-dev `
     --name todo-api-private --mode Incremental --parameters infra/main.bicepparam `
     --parameters deployApi=true apiImage=$image `
       enableApiIngress=false initializeBackendAuth=true
   ```

   Wait with a bounded timeout for successful revision/image pull and RBAC
   propagation. Do not grant broader roles to bypass a transient failure.
   Inspect ACA **Authentication**: platform enabled, unauthenticated action
   **HTTP 401**, no excluded paths. This initial configuration denies all callers.
   Only after that verification, repeat the deployment as `todo-api-link-ready`
   with `enableApiIngress=true` and `initializeBackendAuth=true`. This additional
   ingress activation deliberately avoids first exposing an unprotected public app.
   Keep the rollout window supervised; fail-closed behavior needs live verification.

5. **Supported portal linkage, not ARM linkage alone.** In SWA → **APIs**, select
   the production environment → **Link** → backend type **Container App** → select
   the subscription and this API resource → **Link**. The documented operation
   creates ACA's **Azure Static Web Apps (Linked)** provider and configures access
   to allow requests proxied by the linked SWA. Inspect ACA Authentication to verify
   the provider is enabled, authentication required/anonymous denied, HTTPS required,
   and no excluded board/health routes. If the portal operation fails to replace the
   initial deny-all configuration correctly, keep access denied and investigate;
   never disable authentication to make linkage appear functional.

   No user login is introduced: this is SWA-to-backend platform authentication,
   not an end-user sign-in requirement. The shared board remains anonymous through
   SWA. API paths already contain `/api`; SWA forwards the full path unchanged.
   No ARM `linkedBackends` resource is claimed to perform this security operation.

6. **Authorized acceptance gate — never performed as part of local authoring**:
   - Through the SWA production hostname, anonymous `GET /api/board` must succeed
     with an ETag; test actual create/update/conflicting ETag behavior with approved
     test data, not merely `/api/health` (which does not access Cosmos).
   - From outside ACA, unauthenticated HTTPS requests to the direct ACA hostname
     for `/api/board` and `/api/health` must return **401/403**, never board data or
     a success response. Do not follow redirects and count a login HTML page as success.
     For example, after authorization only:

     ```powershell
     curl.exe --max-time 30 --silent --show-error --output NUL --write-out '%{http_code}' "https://<apiFqdn>/api/board"
     curl.exe --max-time 30 --silent --show-error --output NUL --write-out '%{http_code}' "https://<apiFqdn>/api/health"
     ```

   - A direct mutation with approved test data must also be rejected, with state
     unchanged. Requests with forged `Origin`/`X-MS-CLIENT-PRINCIPAL` must not bypass
     protection. Inspect auth configuration and test applicable revision/label URLs
     as well; do not expose unauthenticated alternative routes.
   - Any unexpected direct success blocks acceptance: restore environment-only
     ingress/deny-all auth and investigate. Do not call linkage secure until the
     negative checks pass. No live auth test is authorized by this document.

7. After linking, **every subsequent API deployment** must explicitly retain:
   `deployApi=true`, the real `apiImage`,
   `enableApiIngress=true`, **`initializeBackendAuth=false`**. The portal owns the
   linked-provider auth child resource; incremental deployment leaves it unchanged.
   The bootstrap parameter file alone will not preserve a successful running app's
   intended rollout state. Setting `deployApi=false` in incremental mode does not
   delete an existing app; it only skips management and produces empty API outputs.
   Reinitializing auth intentionally denies all access and requires relinking.
   Unlinking normally retains the provider to avoid anonymous exposure; verify this.

## Outputs

`staticWebAppResourceId`, `staticWebAppName`, `staticWebAppResourceGroup`;
`registryResourceId`, `registryName`, `registryLoginServer`;
`identityResourceId`, `identityClientId`, `identityPrincipalId`;
`cosmosAccountResourceId`, `cosmosEndpoint`, `cosmosDatabaseName`,
`cosmosContainerName`, `cosmosContainerResourceId`, `cosmosRoleAssignmentId`;
`environmentResourceId`, `workspaceResourceId`;
`apiName`, `apiResourceId`, `apiFqdn`, `apiDeployed`.
API resource ID/FQDN are empty in bootstrap; no fabricated sample URL or health
claim. None of these outputs is a password, token, connection string or access key.

## Local validation

Local-only compilation (no Azure deployment or resource access):

```powershell
& 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd' bicep build --file infra/main.bicep --stdout
& 'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd' bicep build-params --file infra/main.bicepparam --stdout
```

Compiler: Bicep CLI 0.48.1. Compilation validates template/parameter syntax and
available type schemas, not resource existence, preservation of live SWA settings,
Azure policy, provider availability, container startup, RBAC propagation, Cosmos
metadata authorization, image contents, auth enforcement or successful linkage.
No ARM validation/what-if/deployment, ACR build, Azure login, or live authentication
test is performed in this authoring task.

Official guidance consulted:
- [SWA with Container Apps: portal linking and backend access](https://learn.microsoft.com/azure/static-web-apps/apis-container-apps)
- [ACA authConfigs ARM schema](https://learn.microsoft.com/azure/templates/microsoft.app/2024-03-01/containerapps/authconfigs)
