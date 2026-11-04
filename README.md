# ToDo Board

A frontend-only ToDo board built with React, TypeScript, and Vite. Tasks and categories are stored in the browser; no account or backend is required.

## Local development

Requirements: Node.js 22 and npm.

```sh
npm ci
npm run dev
```

The app opens directly to the board. To run the checks:

```sh
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

## Data and privacy

Board data stays in browser `localStorage`. Export creates a JSON backup; import validates the file and asks before replacing current data. Browser storage is not a substitute for a backup.

## Azure Static Web Apps

The app is static and does not use Azure Functions. The Bicep template in [`infra/main.bicep`](infra/main.bicep) describes the Static Web App resource, and [`infra/main.bicepparam`](infra/main.bicepparam) provides example parameters. Review and validate the template before deploying it. **No Azure resources are provisioned by this repository's local development or validation commands.**

If you explicitly choose to provision a Static Web App, first create or select an Azure resource group, then run the reviewed Bicep deployment from an authenticated Azure CLI session:

```sh
az deployment group create \
  --resource-group <resource-group> \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam
```

Before deploying, confirm the parameter file's resource name, location, and hosting tier are appropriate for your subscription. The template creates Azure resources; do not run the deployment command without authorization.

### Automatic deployment from `main`

The GitHub Actions workflow at [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml):

- Runs lint, type-checking, unit/component tests, Playwright browser tests, and a production build on pull requests targeting `main` and pushes to `main`.
- Deploys to Azure Static Web Apps only for a push to `main`, after validation succeeds.

To enable deployment, create the Static Web App and add its deployment token as the repository Actions secret `AZURE_STATIC_WEB_APPS_API_TOKEN`. The workflow does not provision the app or create/configure secrets. Pull requests do not deploy.
