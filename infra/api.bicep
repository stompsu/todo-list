targetScope = 'resourceGroup'

param name string
param location string
param tags object
param environmentId string
param identityId string
param identityClientId string
param registryServer string
@minLength(1)
param image string
param cosmosEndpoint string
param databaseName string
param containerName string
param maxReplicas int
param enableIngress bool
param initializeBackendAuth bool

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: enableIngress
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        { server: registryServer, identity: identityId }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: image
          resources: { cpu: json('0.25'), memory: '0.5Gi' }
          env: [
            { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
            { name: 'ASPNETCORE_HTTP_PORTS', value: '8080' }
            { name: 'AZURE_CLIENT_ID', value: identityClientId }
            { name: 'Storage__Mode', value: 'Cosmos' }
            { name: 'Cosmos__Endpoint', value: cosmosEndpoint }
            { name: 'Cosmos__Database', value: databaseName }
            { name: 'Cosmos__Container', value: containerName }
          ]
          // Transport probes avoid treating the storage-independent /api/health as Cosmos readiness.
          probes: [
            {
              type: 'Startup'
              tcpSocket: { port: 8080 }
              periodSeconds: 5
              failureThreshold: 30
            }
            {
              type: 'Readiness'
              tcpSocket: { port: 8080 }
              periodSeconds: 10
              failureThreshold: 3
            }
            {
              type: 'Liveness'
              tcpSocket: { port: 8080 }
              periodSeconds: 30
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: maxReplicas
        rules: [
          { name: 'http', http: { metadata: { concurrentRequests: '10' } } }
        ]
      }
    }
  }
}

// Fail closed before exposing external ingress. Portal linking subsequently owns the provider.
// Never reinitialize this after linking unless deliberately putting the backend into deny-all mode.
resource initialAuth 'Microsoft.App/containerApps/authConfigs@2024-03-01' = if (initializeBackendAuth) {
  parent: app
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      unauthenticatedClientAction: 'Return401'
      excludedPaths: []
    }
    httpSettings: { requireHttps: true }
  }
}

output resourceId string = app.id
output fqdn string = app.properties.configuration.ingress.fqdn
