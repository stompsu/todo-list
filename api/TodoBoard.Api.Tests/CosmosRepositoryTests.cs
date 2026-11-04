using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using TodoBoard.Api.Board;
using TodoBoard.Api.Storage;

namespace TodoBoard.Api.Tests;

/// <summary>Exercises the real repository against the Cosmos SDK boundary; no Azure connection.</summary>
public sealed class CosmosRepositoryTests
{
    private readonly Container _container = Substitute.For<Container>();
    private CosmosBoardRepository Repository => new(_container, NullLogger<CosmosBoardRepository>.Instance);
    private static BoardData Board => new(1, [new("c", "Category")],
        [new("b", "Second", "", null, "#123456", "completed"),
         new("a", "First", "Details", "c", "#ABCDEF", "in-progress")]);

    private static ResponseMessage Response(HttpStatusCode status, string? etag = null, string? content = null, int substatus = 0)
    {
        var response = new ResponseMessage(status);
        if (etag is not null) response.Headers.Add("etag", etag);
        if (substatus != 0) response.Headers.Add("x-ms-substatus", substatus.ToString());
        if (content is not null) response.Content = new MemoryStream(Encoding.UTF8.GetBytes(content));
        return response;
    }

    private void ReadReturns(ResponseMessage response) =>
        _container.ReadItemStreamAsync(BoardDocument.Id, new PartitionKey(BoardDocument.Id),
            Arg.Any<ItemRequestOptions>(), Arg.Any<CancellationToken>()).Returns(response);

    private void ContainerReturns(HttpStatusCode status) =>
        _container.ReadContainerStreamAsync(Arg.Any<ContainerRequestOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ => Response(status));

    [Fact]
    public async Task Read_RoundTripsBoardAndOrder_IgnoresCosmosMetadata()
    {
        var json = Encoding.UTF8.GetString(BoardDocument.Serialize(Board));
        json = json[..^1] + ",\"_etag\":\"system-property\",\"_ts\":123}";
        ReadReturns(Response(HttpStatusCode.OK, "\"current\"", json));
        var snapshot = await Repository.GetAsync(default);
        Assert.Equal("\"current\"", snapshot.ETag);
        Assert.Equal(JsonSerializer.Serialize(Board), JsonSerializer.Serialize(snapshot.Board));
        await _container.DidNotReceive().ReadContainerStreamAsync(
            Arg.Any<ContainerRequestOptions>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task MissingItem_WithExistingContainer_ReturnsInitialBoard()
    {
        ReadReturns(Response(HttpStatusCode.NotFound));
        ContainerReturns(HttpStatusCode.OK);
        var snapshot = await Repository.GetAsync(default);
        Assert.Equal(BoardETags.Initial, snapshot.ETag);
        Assert.Empty(snapshot.Board.Tasks);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1003)]
    public async Task MissingContainer_IsUnavailable_NotAnEmptyBoard(int substatus)
    {
        ReadReturns(Response(HttpStatusCode.NotFound, substatus: substatus));
        ContainerReturns(HttpStatusCode.NotFound);
        await Assert.ThrowsAsync<BoardStorageUnavailableException>(() => Repository.GetAsync(default));
    }

    [Theory]
    [InlineData("null")]
    [InlineData("{")]
    [InlineData("{\"version\":1,\"categories\":[],\"tasks\":[null]}")]
    [InlineData("{\"version\":2,\"categories\":[],\"tasks\":[]}")]
    public async Task InvalidStoredBoard_FailsExplicitly(string body)
    {
        ReadReturns(Response(HttpStatusCode.OK, "\"tag\"", body));
        await Assert.ThrowsAsync<BoardStorageCorruptException>(() => Repository.GetAsync(default));
    }

    [Fact]
    public async Task ReadWithoutETag_IsUnavailable()
    {
        ReadReturns(Response(HttpStatusCode.OK, content: Encoding.UTF8.GetString(BoardDocument.Serialize(Board))));
        await Assert.ThrowsAsync<BoardStorageUnavailableException>(() => Repository.GetAsync(default));
    }

    [Fact]
    public async Task Create_UsesFixedIdPartitionAndReturnsCommittedBoard()
    {
        byte[]? sent = null;
        _container.CreateItemStreamAsync(Arg.Any<Stream>(), Arg.Any<PartitionKey>(),
            Arg.Any<ItemRequestOptions>(), Arg.Any<CancellationToken>()).Returns(call =>
        {
            using var copy = new MemoryStream();
            call.Arg<Stream>().CopyTo(copy);
            sent = copy.ToArray();
            Assert.Equal(new PartitionKey(BoardDocument.Id), call.Arg<PartitionKey>());
            Assert.Null(call.Arg<ItemRequestOptions>().IfMatchEtag);
            return Response(HttpStatusCode.Created, "\"new\"");
        });
        var result = Assert.IsType<SaveBoardResult.Saved>(await Repository.SaveAsync(Board, BoardETags.Initial, default));
        Assert.Equal("\"new\"", result.Snapshot.ETag);
        Assert.Equal(JsonSerializer.Serialize(Board), JsonSerializer.Serialize(result.Snapshot.Board));
        Assert.Equal(BoardDocument.Serialize(Board), sent);
        await _container.DidNotReceive().ReplaceItemStreamAsync(Arg.Any<Stream>(), Arg.Any<string>(),
            Arg.Any<PartitionKey>(), Arg.Any<ItemRequestOptions>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(200, true)]
    [InlineData(412, false)]
    [InlineData(404, false)]
    public async Task Replace_UsesIfMatchWithoutUpsert(int status, bool saved)
    {
        ContainerReturns(HttpStatusCode.OK);
        _container.ReplaceItemStreamAsync(Arg.Any<Stream>(), BoardDocument.Id,
            Arg.Is<PartitionKey>(key => key == new PartitionKey(BoardDocument.Id)),
            Arg.Is<ItemRequestOptions>(options => options.IfMatchEtag == "\"old\""),
            Arg.Any<CancellationToken>()).Returns(_ => Response((HttpStatusCode)status, "\"new\""));
        var result = await Repository.SaveAsync(Board, "\"old\"", default);
        if (saved) Assert.Equal("\"new\"", Assert.IsType<SaveBoardResult.Saved>(result).Snapshot.ETag);
        else Assert.IsType<SaveBoardResult.PreconditionFailed>(result);
        await _container.DidNotReceive().CreateItemStreamAsync(Arg.Any<Stream>(), Arg.Any<PartitionKey>(),
            Arg.Any<ItemRequestOptions>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task ConcurrentCreates_ConflictIsStale_OnlyOneCommits()
    {
        var created = 0;
        _container.CreateItemStreamAsync(Arg.Any<Stream>(), Arg.Any<PartitionKey>(),
            Arg.Any<ItemRequestOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ => Response(Interlocked.Increment(ref created) == 1
                ? HttpStatusCode.Created : HttpStatusCode.Conflict, "\"winner\""));
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
            Task.Run(() => Repository.SaveAsync(Board, BoardETags.Initial, default))));
        Assert.Single(results.OfType<SaveBoardResult.Saved>());
        Assert.Equal(7, results.OfType<SaveBoardResult.PreconditionFailed>().Count());
    }

    [Theory]
    [InlineData(401)]
    [InlineData(403)]
    [InlineData(404)]
    [InlineData(429)]
    [InlineData(500)]
    [InlineData(503)]
    public async Task StorageErrors_AreUnavailable_OnReadAndCreate(int status)
    {
        ReadReturns(Response((HttpStatusCode)status));
        ContainerReturns(HttpStatusCode.NotFound);
        _container.CreateItemStreamAsync(Arg.Any<Stream>(), Arg.Any<PartitionKey>(),
            Arg.Any<ItemRequestOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ => Response((HttpStatusCode)status));
        await Assert.ThrowsAsync<BoardStorageUnavailableException>(() => Repository.GetAsync(default));
        await Assert.ThrowsAsync<BoardStorageUnavailableException>(() => Repository.SaveAsync(Board, BoardETags.Initial, default));
    }

    [Fact]
    public async Task Throttling_PreservesRetryAfter()
    {
        var response = Response(HttpStatusCode.TooManyRequests);
        response.Headers.Add("x-ms-retry-after-ms", "2500");
        ReadReturns(response);
        var error = await Assert.ThrowsAsync<BoardStorageUnavailableException>(() => Repository.GetAsync(default));
        Assert.Equal(TimeSpan.FromMilliseconds(2500), error.RetryAfter);
    }

    [Fact]
    public async Task Replace_MissingContainer_IsUnavailable_NotStale()
    {
        ContainerReturns(HttpStatusCode.NotFound);
        _container.ReplaceItemStreamAsync(Arg.Any<Stream>(), Arg.Any<string>(), Arg.Any<PartitionKey>(),
            Arg.Any<ItemRequestOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ => Response(HttpStatusCode.NotFound));
        await Assert.ThrowsAsync<BoardStorageUnavailableException>(() => Repository.SaveAsync(Board, "\"old\"", default));
    }

    [Fact]
    public async Task WriteWithoutETag_DoesNotReportSuccess()
    {
        _container.CreateItemStreamAsync(Arg.Any<Stream>(), Arg.Any<PartitionKey>(),
            Arg.Any<ItemRequestOptions>(), Arg.Any<CancellationToken>())
            .Returns(_ => Response(HttpStatusCode.Created));
        await Assert.ThrowsAsync<BoardStorageUnavailableException>(() => Repository.SaveAsync(Board, BoardETags.Initial, default));
    }

    [Fact]
    public async Task OversizedDocument_IsRejectedBeforeCosmos()
    {
        var board = new BoardData(1, [], Enumerable.Range(0, 2000)
            .Select(i => new BoardTask(i.ToString(), "Title", new string('x', 1000), null, "#123456", "todo")).ToArray());
        await Assert.ThrowsAsync<BoardDocumentTooLargeException>(() => Repository.SaveAsync(board, BoardETags.Initial, default));
        await _container.DidNotReceive().CreateItemStreamAsync(Arg.Any<Stream>(), Arg.Any<PartitionKey>(),
            Arg.Any<ItemRequestOptions>(), Arg.Any<CancellationToken>());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Cancellation_SeparatesCallerAbortFromStorageTimeout(bool callerAborted)
    {
        using var cts = new CancellationTokenSource();
        if (callerAborted) cts.Cancel();
        _container.ReadItemStreamAsync(BoardDocument.Id, new PartitionKey(BoardDocument.Id),
            Arg.Any<ItemRequestOptions>(), Arg.Any<CancellationToken>())
            .Returns<Task<ResponseMessage>>(_ => throw new OperationCanceledException());
        if (callerAborted)
            await Assert.ThrowsAsync<OperationCanceledException>(() => Repository.GetAsync(cts.Token));
        else
            await Assert.ThrowsAsync<BoardStorageUnavailableException>(() => Repository.GetAsync(cts.Token));
    }
}
