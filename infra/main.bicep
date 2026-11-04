targetScope = 'resourceGroup'

@description('Keep the deployed resource names stable between bootstrap and API rollout.')
@minLength(2)
@maxLength(20)
param namePrefix string = 'todo-board-dev'

param location string = 'westeurope'
param staticWebAppName string = 'todo-board-dev-20261104-1046'
param staticWebAppResourceGroup string = 'rg-todolist-dev'
@description('Must match the existing SWA region; do not use this to move it.')
param staticWebAppLocation string = 'westeurope'
@description('Explicit deployment opt-in to manage the existing SWA at Standard; false only references it.')
param upgradeStaticWebApp bool = true

param registryName string = 'todo${uniqueString(resourceGroup().id)}'
param identityName string = '${namePrefix}-api-mi'
param environmentName string = '${namePrefix}-env'
param apiName string = '${namePrefix}-api'
param cosmosAccountName string = '${namePrefix}-${uniqueString(resourceGroup().id)}'
param databaseName string = 'todo'
param containerName string = 'boards'
param workspaceName string = '${namePrefix}-logs'
param tags object = {
  application: 'todo-board'
  environment: 'dev'
}

@description('Bootstrap is false: no container app or placeholder image is deployed.')
param deployApi bool = false
@description('Full private ACR image reference, preferably repository@sha256:digest. Required when deployApi=true.')
param apiImage string = ''
@description('Keep false until initial deny-by-default ACA authentication exists and is inspected. See README.')
param enableApiIngress bool = false
@description('Create/reset deny-all authentication before portal linking. Set false AFTER linking, to preserve the portal-managed SWA provider.')
param initializeBackendAuth bool = true
@minValue(1)
@maxValue(5)
param maxReplicas int = 2
@minValue(30)
@maxValue(730)
param logRetentionDays int = 30

resource staticWebApp 'Microsoft.Web/staticSites@2024-04-01' existing = {
  name: staticWebAppName
  scope: resourceGroup(staticWebAppResourceGroup)
}

module staticWebAppUpgrade './static-web-app.bicep' = if (upgradeStaticWebApp) {
  name: 'todo-swa-standard'
  scope: resourceGroup(staticWebAppResourceGroup)
  params: {
    name: staticWebAppName
    location: staticWebAppLocation
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: tags
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [
      { name: 'EnableServerless' }
    ]
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    minimalTlsVersion: 'Tls12'
    backupPolicy: {
      type: 'Periodic'
      periodicModeProperties: {
        backupIntervalInMinutes: 240
        backupRetentionIntervalInHours: 24
        backupStorageRedundancy: 'Local'
      }
    }
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

resource container 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: database
  name: containerName
  properties: {
    resource: {
      id: containerName
      partitionKey: {
        paths: [ '/id' ]
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [ { path: '/"_etag"/?' } ]
      }
    }
  }
}

// Metadata discovery is required by the SDK. No deletes, queries, or management-plane writes.
resource boardRole 'Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, 'todo-board-read-create-replace')
  properties: {
    roleName: 'Todo board read create replace'
    type: 'CustomRole'
    assignableScopes: [ cosmos.id ]
    permissions: [
      {
        dataActions: [
          'Microsoft.DocumentDB/databaseAccounts/readMetadata'
          'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/read'
          'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/create'
          'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/replace'
        ]
      }
    ]
  }
}

resource boardAccess 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(container.id, identity.id, boardRole.id)
  properties: {
    principalId: identity.properties.principalId
    roleDefinitionId: boardRole.id
    scope: container.id
  }
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    workloadProfiles: [
      { name: 'Consumption', workloadProfileType: 'Consumption' }
    ]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
  }
}

resource cosmosDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'todo-cosmos-monitoring'
  scope: cosmos
  properties: {
    workspaceId: workspace.id
    logs: [ { category: 'DataPlaneRequests', enabled: true } ]
    metrics: [ { category: 'Requests', enabled: true } ]
  }
}

module api './api.bicep' = if (deployApi) {
  name: 'todo-api'
  params: {
    name: apiName
    location: location
    tags: tags
    environmentId: environment.id
    identityId: identity.id
    identityClientId: identity.properties.clientId
    registryServer: registry.properties.loginServer
    image: startsWith(apiImage, '${registryName}.azurecr.io/') ? apiImage : ''
    cosmosEndpoint: cosmos.properties.documentEndpoint
    databaseName: databaseName
    containerName: containerName
    maxReplicas: maxReplicas
    enableIngress: enableApiIngress
    initializeBackendAuth: initializeBackendAuth
  }
  dependsOn: [ acrPull, boardAccess ]
}

output staticWebAppResourceId string = staticWebApp.id
output staticWebAppName string = staticWebAppName
output staticWebAppResourceGroup string = staticWebAppResourceGroup
output registryResourceId string = registry.id
output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output identityResourceId string = identity.id
output identityClientId string = identity.properties.clientId
output identityPrincipalId string = identity.properties.principalId
output cosmosAccountResourceId string = cosmos.id
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output cosmosDatabaseName string = database.name
output cosmosContainerName string = container.name
output cosmosContainerResourceId string = container.id
output cosmosRoleAssignmentId string = boardAccess.id
output environmentResourceId string = environment.id
output workspaceResourceId string = workspace.id
output apiName string = apiName
output apiResourceId string = deployApi ? api!.outputs.resourceId : ''
output apiFqdn string = deployApi ? api!.outputs.fqdn : ''
output apiDeployed bool = deployApi
