targetScope = 'resourceGroup'

param name string
param location string

// ARM has no update-only PUT. Operator MUST first verify this exact existing resource.
// No repository token, source-control binding, deployment token, or login is authored here.
resource site 'Microsoft.Web/staticSites@2024-04-01' = {
  name: name
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {}
}

output resourceId string = site.id
