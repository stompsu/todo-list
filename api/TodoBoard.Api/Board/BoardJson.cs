using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TodoBoard.Api.Board;

public static class BoardJson
{
    /// <summary>Strict options for untrusted request bodies.</summary>
    public static JsonSerializerOptions Request { get; } = new()
    {
        PropertyNameCaseInsensitive = false,
        NumberHandling = JsonNumberHandling.Strict,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        AllowDuplicateProperties = false,
        AllowTrailingCommas = false,
        ReadCommentHandling = JsonCommentHandling.Disallow,
        MaxDepth = 8,
    };

    /// <summary>Options for reading the stored Cosmos document (which also carries id and Cosmos system properties).</summary>
    public static JsonSerializerOptions Stored { get; } = new()
    {
        PropertyNameCaseInsensitive = false,
        NumberHandling = JsonNumberHandling.Strict,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Skip,
        AllowDuplicateProperties = false,
        MaxDepth = 8,
    };

    /// <summary>Options for writing the Cosmos document (compact, non-ASCII kept raw to save space).</summary>
    public static JsonSerializerOptions StoredWrite { get; } = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Options for HTTP responses (HTML-safe default encoder, nulls always written).</summary>
    public static JsonSerializerOptions Response { get; } = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };
}
