using System.Text.Json;
using System.Text.Json.Serialization;
using TodoBoard.Api.Board;

namespace TodoBoard.Api.Storage;

public sealed record BoardSnapshot(BoardData Board, string ETag);

public abstract record SaveBoardResult
{
    private SaveBoardResult() { }

    public sealed record Saved(BoardSnapshot Snapshot) : SaveBoardResult;

    /// <summary>The supplied If-Match ETag no longer identifies the current board.</summary>
    public sealed record PreconditionFailed : SaveBoardResult;
}

/// <summary>Persistence for the single shared board. Implementations must perform atomic conditional writes.</summary>
public interface IBoardRepository
{
    /// <summary>Returns the board, or <see cref="BoardData.Empty"/> with <see cref="BoardETags.Initial"/> when it was never saved.</summary>
    Task<BoardSnapshot> GetAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Replaces the board only if <paramref name="ifMatch"/> equals the current ETag. When it equals
    /// <see cref="BoardETags.Initial"/>, the board is created only if it does not exist yet.
    /// </summary>
    Task<SaveBoardResult> SaveAsync(BoardData board, string ifMatch, CancellationToken cancellationToken);
}

public static class BoardETags
{
    /// <summary>Strong ETag representing "board not created yet". Never produced by Cosmos (which uses GUID-like tags).</summary>
    public const string Initial = "\"empty\"";
}

/// <summary>Storage is unreachable, throttled, misconfigured, or denied access. Maps to 503.</summary>
public sealed class BoardStorageUnavailableException(string message, TimeSpan? retryAfter = null, Exception? inner = null)
    : Exception(message, inner)
{
    public TimeSpan? RetryAfter { get; } = retryAfter;
}

/// <summary>The stored document cannot be read as a valid board. Maps to 500; never silently replaced.</summary>
public sealed class BoardStorageCorruptException(string message, Exception? inner = null) : Exception(message, inner);

/// <summary>The serialized document would exceed <see cref="BoardLimits.MaxStoredDocumentBytes"/>. Maps to 413.</summary>
public sealed class BoardDocumentTooLargeException(int size)
    : Exception($"Serialized board document is {size} bytes; limit is {BoardLimits.MaxStoredDocumentBytes}.")
{
    public int Size { get; } = size;
}

/// <summary>Persisted document shape: the BoardData contract plus the Cosmos id (also the partition key, path /id).</summary>
public static class BoardDocument
{
    public const string Id = "shared-board";

    private sealed record Stored(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("version")] int Version,
        [property: JsonPropertyName("categories")] IReadOnlyList<BoardCategory> Categories,
        [property: JsonPropertyName("tasks")] IReadOnlyList<BoardTask> Tasks);

    public static byte[] Serialize(BoardData board)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(
            new Stored(Id, board.Version, board.Categories, board.Tasks), BoardJson.StoredWrite);
        if (bytes.Length > BoardLimits.MaxStoredDocumentBytes) throw new BoardDocumentTooLargeException(bytes.Length);
        return bytes;
    }

    public static BoardData Deserialize(Stream utf8Json)
    {
        BoardInput? input;
        try
        {
            input = JsonSerializer.Deserialize<BoardInput>(utf8Json, BoardJson.Stored);
        }
        catch (JsonException ex)
        {
            throw new BoardStorageCorruptException("Stored board document is not valid board JSON.", ex);
        }

        var result = BoardValidator.Validate(input);
        if (!result.IsValid)
        {
            throw new BoardStorageCorruptException(
                "Stored board document failed validation: " + string.Join("; ", result.Errors.Keys.Take(5)));
        }
        return result.Board!;
    }
}
