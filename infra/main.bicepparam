using './main.bicep'

// Local compilation only; running an ARM deployment explicitly upgrades this existing SWA.
param staticWebAppName = 'todo-board-dev-20261104-1046'
param staticWebAppResourceGroup = 'rg-todolist-dev'
param staticWebAppLocation = 'westeurope'
param location = 'westeurope'
param upgradeStaticWebApp = true
param deployApi = false
param enableApiIngress = false
