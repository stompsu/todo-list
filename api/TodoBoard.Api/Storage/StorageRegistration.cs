using Azure.Core;
using Azure.Identity;
using Microsoft.Azure.Cosmos;

namespace TodoBoard.Api.Storage;

public static class StorageRegistration
{
    /// <summary>
    /// Registers exactly one board repository. Misconfiguration fails startup; there is no fallback.
    /// InMemory requires ASPNETCORE_ENVIRONMENT=Development and an explicit Storage__Mode=InMemory.
    /// </summary>
    public static BoardStorageMode AddBoardStorage(
        this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        var mode = (configuration.GetSection(StorageOptions.Section).Get<StorageOptions>() ?? new()).Mode;

        if (mode == BoardStorageMode.InMemory)
        {
            if (!environment.IsDevelopment())
            {
                throw new InvalidOperationException(
                    $"Storage:Mode=InMemory is only allowed in the Development environment (current: {environment.EnvironmentName}).");
            }
            services.AddSingleton<IBoardRepository, InMemoryBoardRepository>();
            return mode;
        }

        if (mode != BoardStorageMode.Cosmos)
        {
            throw new InvalidOperationException($"Unsupported Storage:Mode '{mode}'.");
        }

        var cosmos = configuration.GetSection(CosmosOptions.Section).Get<CosmosOptions>() ?? new();
        var missing = new List<string>();
        if (!Uri.TryCreate(cosmos.Endpoint, UriKind.Absolute, out var endpoint) || endpoint.Scheme != Uri.UriSchemeHttps)
            missing.Add("Cosmos__Endpoint (absolute https URI)");
        if (string.IsNullOrWhiteSpace(cosmos.Database)) missing.Add("Cosmos__Database");
        if (string.IsNullOrWhiteSpace(cosmos.Container)) missing.Add("Cosmos__Container");
        if (missing.Count > 0)
        {
            throw new InvalidOperationException(
                "Cosmos storage is not configured. Set: " + string.Join(", ", missing) +
                ". (For local Development without Azure, set Storage__Mode=InMemory.)");
        }

        services.AddSingleton(_ => new CosmosClient(
            endpoint!.ToString(),
            // Production must never fall back to environment secrets or developer credentials.
            environment.IsDevelopment()
                ? (TokenCredential)new DefaultAzureCredential()
                : new ManagedIdentityCredential(
                    string.IsNullOrWhiteSpace(configuration["AZURE_CLIENT_ID"])
                        ? ManagedIdentityId.SystemAssigned
                        : ManagedIdentityId.FromUserAssignedClientId(configuration["AZURE_CLIENT_ID"]!)),
            new CosmosClientOptions
            {
                ApplicationName = "todo-board-api",
                RequestTimeout = TimeSpan.FromSeconds(10),
                MaxRetryAttemptsOnRateLimitedRequests = 3,
                MaxRetryWaitTimeOnRateLimitedRequests = TimeSpan.FromSeconds(5),
            }));
        services.AddSingleton<IBoardRepository>(sp => new CosmosBoardRepository(
            sp.GetRequiredService<CosmosClient>().GetContainer(cosmos.Database, cosmos.Container),
            sp.GetRequiredService<ILogger<CosmosBoardRepository>>()));
        return mode;
    }
}
