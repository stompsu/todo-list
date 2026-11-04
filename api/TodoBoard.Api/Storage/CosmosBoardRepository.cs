using System.Net;
using Azure;
using Azure.Identity;
using Microsoft.Azure.Cosmos;
using TodoBoard.Api.Board;

namespace TodoBoard.Api.Storage;

/// <summary>
/// Cosmos DB for NoSQL repository. Stores the board as one item with id <see cref="BoardDocument.Id"/>
/// in a container whose partition key path is <c>/id</c>. All writes are conditional:
/// first save uses create (fails if the item exists), later saves use replace with If-Match.
/// </summary>
public sealed class CosmosBoardRepository(Container container, ILogger<CosmosBoardRepository> logger) : IBoardRepository
{
    private static readonly PartitionKey Key = new(BoardDocument.Id);

    public async Task<BoardSnapshot> GetAsync(CancellationToken cancellationToken)
    {
        using var response = await Execute(
            ct => container.ReadItemStreamAsync(BoardDocument.Id, Key, cancellationToken: ct),
            "read", cancellationToken);

        if (response.StatusCode == HttpStatusCode.OK)
        {
            var etag = RequireETag(response, "read");
            return new BoardSnapshot(BoardDocument.Deserialize(response.Content), etag);
        }
        if (response.StatusCode == HttpStatusCode.NotFound && SubStatus(response) == 0)
        {
            await EnsureContainerAvailable(cancellationToken);
            return new BoardSnapshot(BoardData.Empty, BoardETags.Initial);
        }
        throw Unavailable(response, "read");
    }

    public async Task<SaveBoardResult> SaveAsync(BoardData board, string ifMatch, CancellationToken cancellationToken)
    {
        var payload = BoardDocument.Serialize(board);
        var options = new ItemRequestOptions { EnableContentResponseOnWrite = false };
        var isCreate = string.Equals(ifMatch, BoardETags.Initial, StringComparison.Ordinal);
        if (!isCreate) options.IfMatchEtag = ifMatch;

        using var stream = new MemoryStream(payload, writable: false);
        using var response = await Execute(
            ct => isCreate
                ? container.CreateItemStreamAsync(stream, Key, options, ct)
                : container.ReplaceItemStreamAsync(stream, BoardDocument.Id, Key, options, ct),
            isCreate ? "create" : "replace", cancellationToken);

        switch (response.StatusCode)
        {
            case HttpStatusCode.OK or HttpStatusCode.Created:
                return new SaveBoardResult.Saved(new BoardSnapshot(board, RequireETag(response, "write")));

            // Create lost the race to another writer, or replace saw a newer ETag.
            case HttpStatusCode.Conflict when isCreate:
            case HttpStatusCode.PreconditionFailed:
                logger.LogInformation("Board {Operation} rejected as stale (Cosmos status {Status}).",
                    isCreate ? "create" : "replace", (int)response.StatusCode);
                return new SaveBoardResult.PreconditionFailed();

            case HttpStatusCode.NotFound when !isCreate && SubStatus(response) == 0:
                // A missing database/container must not masquerade as an empty board or a stale write.
                await EnsureContainerAvailable(cancellationToken);
                return new SaveBoardResult.PreconditionFailed();

            case HttpStatusCode.RequestEntityTooLarge:
                throw new BoardDocumentTooLargeException(payload.Length);

            default:
                throw Unavailable(response, isCreate ? "create" : "replace");
        }
    }

    private async Task EnsureContainerAvailable(CancellationToken ct)
    {
        using var response = await Execute(
            token => container.ReadContainerStreamAsync(cancellationToken: token), "check container", ct);
        if (response.StatusCode != HttpStatusCode.OK) throw Unavailable(response, "check container");
    }

    private async Task<ResponseMessage> Execute(
        Func<CancellationToken, Task<ResponseMessage>> call, string operation, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            return await call(deadline.Token);
        }
        catch (CosmosException ex)
        {
            logger.LogError(ex, "Cosmos {Operation} failed with status {Status}/{SubStatus}, activity {ActivityId}.",
                operation, (int)ex.StatusCode, ex.SubStatusCode, ex.ActivityId);
            throw new BoardStorageUnavailableException("Board storage request failed.", ex.RetryAfter, ex);
        }
        catch (Exception ex) when (ex is AuthenticationFailedException or CredentialUnavailableException
                                       or RequestFailedException or HttpRequestException)
        {
            logger.LogError(ex, "Cosmos {Operation} failed: storage or credential unavailable.", operation);
            throw new BoardStorageUnavailableException("Board storage is unavailable.", null, ex);
        }
        catch (OperationCanceledException ex) when (!ct.IsCancellationRequested)
        {
            logger.LogError(ex, "Cosmos {Operation} timed out.", operation);
            throw new BoardStorageUnavailableException("Board storage timed out.", null, ex);
        }
    }

    private BoardStorageUnavailableException Unavailable(ResponseMessage response, string operation)
    {
        // 401/403 = managed identity / RBAC misconfiguration; 404 with substatus = database/container missing;
        // 429 = throttled after SDK retries; 408/449/5xx = transient service errors. None are reported as success.
        logger.LogError(
            "Cosmos {Operation} failed with status {Status}/{SubStatus}, activity {ActivityId}: {Error}",
            operation, (int)response.StatusCode, SubStatus(response), response.Headers.ActivityId, response.ErrorMessage);
        return new BoardStorageUnavailableException(
            "Board storage request failed.", RetryAfter(response));
    }

    private string RequireETag(ResponseMessage response, string operation)
    {
        var etag = response.Headers.ETag;
        if (string.IsNullOrEmpty(etag))
        {
            logger.LogError("Cosmos {Operation} succeeded without an ETag header.", operation);
            throw new BoardStorageUnavailableException("Board storage returned an incomplete response.");
        }
        return etag;
    }

    private static TimeSpan? RetryAfter(ResponseMessage response) =>
        double.TryParse(response.Headers["x-ms-retry-after-ms"], System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var ms) && ms > 0
            ? TimeSpan.FromMilliseconds(ms)
            : null;

    private static int SubStatus(ResponseMessage response) =>
        int.TryParse(response.Headers["x-ms-substatus"], out var value) ? value : 0;
}
