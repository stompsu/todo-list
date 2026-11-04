targetScope = 'resourceGroup'

@description('Globally unique name for the Azure Static Web App.')
@minLength(2)
@maxLength(60)
param staticWebAppName string

@description('Azure region for the Static Web App.')
param location string = resourceGroup().location

@description('Static Web Apps hosting tier.')
@allowed([
  'Free'
  'Standard'
])
param skuName string = 'Free'

resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: skuName
    tier: skuName
  }
  properties: {}
}

output staticWebAppResourceId string = staticWebApp.id
