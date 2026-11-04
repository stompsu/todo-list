using System.ComponentModel.DataAnnotations;

namespace TodoBoard.Api.Storage;

public enum BoardStorageMode
{
    Cosmos,
    /// <summary>Development-only, process-local storage. Rejected at startup in any other environment.</summary>
    InMemory,
}

public sealed class StorageOptions
{
    public const string Section = "Storage";

    /// <summary>Defaults to Cosmos so a production host can never fall back to memory silently.</summary>
    public BoardStorageMode Mode { get; set; } = BoardStorageMode.Cosmos;
}

/// <summary>Bound from Cosmos__Endpoint, Cosmos__Database, Cosmos__Container. Production access uses managed identity only.</summary>
public sealed class CosmosOptions
{
    public const string Section = "Cosmos";

    [Required] public string Endpoint { get; set; } = "";
    [Required] public string Database { get; set; } = "";
    [Required] public string Container { get; set; } = "";
}
