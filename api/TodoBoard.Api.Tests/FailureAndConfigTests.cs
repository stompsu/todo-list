using System.Net;
using Microsoft.Extensions.Logging;
using TodoBoard.Api.Board;
using TodoBoard.Api.Storage;
using static TodoBoard.Api.Tests.Boards;

namespace TodoBoard.Api.Tests;

public sealed class StorageFailureTests
{
    private sealed class ThrowingRepository(Exception exception) : IBoardRepository
    {
        public Task<BoardSnapshot> GetAsync(CancellationToken cancellationToken) => throw exception;
        public Task<SaveBoardResult> SaveAsync(BoardData board, string ifMatch, CancellationToken cancellationToken) => throw exception;
    }

    private const string Internal = "secret-internal-detail https://acct.documents.azure.com";

    public static TheoryData<Exception, HttpStatusCode> Failures => new()
    {
        { new BoardStorageUnavailableException(Internal, TimeSpan.FromSeconds(3)), HttpStatusCode.ServiceUnavailable },
        { new BoardStorageCorruptException(Internal), HttpStatusCode.InternalServerError },
        { new BoardDocumentTooLargeException(2_000_000), HttpStatusCode.RequestEntityTooLarge },
        { new InvalidOperationException(Internal), HttpStatusCode.InternalServerError },
    };

    [Theory]
    [MemberData(nameof(Failures))]
    public async Task StorageFailures_AreExplicitProblemsWithoutInternals(Exception failure, HttpStatusCode expected)
    {
        using var factory = new BoardApiFactory(repository: new ThrowingRepository(failure));
        using var client = factory.CreateClient();

        var put = await Put(client, Sample, "\"abc\"");
        Assert.Equal(expected, put.StatusCode);
        Assert.Null(put.Headers.ETag);
        var putProblem = await Problem(put);
        Assert.DoesNotContain("secret-internal-detail", putProblem.ToJsonString());
        Assert.DoesNotContain("documents.azure.com", putProblem.ToJsonString());

        if (failure is not BoardDocumentTooLargeException)
        {
            var get = await client.GetAsync("/api/board");
            Assert.Equal(expected, get.StatusCode);
            Assert.DoesNotContain("secret-internal-detail", await get.Content.ReadAsStringAsync());
        }
        if (expected == HttpStatusCode.ServiceUnavailable)
        {
            Assert.Equal(TimeSpan.FromSeconds(3), put.Headers.RetryAfter?.Delta);
            Assert.Contains("may have committed", putProblem["detail"]!.ToString());
        }
    }

    [Fact]
    public async Task Validation_RunsBeforeStorage()
    {
        using var factory = new BoardApiFactory(repository: new ThrowingRepository(new InvalidOperationException("must not be called")));
        using var client = factory.CreateClient();
        var response = await Put(client, """{"version":1,"categories":[],"tasks":[null]}""", "\"abc\"");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}

public sealed class RateLimitingTests
{
    [Fact]
    public async Task Reads_OverGlobalLimit_Return429_AndHealthIsExempt()
    {
        using var factory = new BoardApiFactory(new Dictionary<string, string?> { ["RateLimiting:ReadsGlobal"] = "1" });
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/board")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync("/api/board")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);
    }

    [Fact]
    public async Task Writes_OverPerClientLimit_Return429WithRetryAfter_AndHealthIsExempt()
    {
        using var factory = new BoardApiFactory(new Dictionary<string, string?>
        {
            ["RateLimiting:WritesPerClient"] = "2",
            ["RateLimiting:ReadsPerClient"] = "3",
        });
        using var client = factory.CreateClient();

        var first = await Put(client, WithTask("1"), "\"empty\"");
        var second = await Put(client, WithTask("2"), ETagOf(first));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);

        var limited = await Put(client, WithTask("3"), ETagOf(second));
        Assert.Equal(HttpStatusCode.TooManyRequests, limited.StatusCode);
        Assert.NotNull(limited.Headers.RetryAfter);
        Assert.Equal(429, (int)(await Problem(limited))["status"]!);

        for (var i = 0; i < 3; i++) Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/board")).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.GetAsync("/api/board")).StatusCode);

        for (var i = 0; i < 10; i++) Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);
    }

    [Fact]
    public async Task Writes_OverGlobalLimit_Return429()
    {
        using var factory = new BoardApiFactory(new Dictionary<string, string?> { ["RateLimiting:WritesGlobal"] = "1" });
        using var client = factory.CreateClient();
        var first = await Put(client, WithTask("1"), "\"empty\"");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Put(client, WithTask("2"), ETagOf(first))).StatusCode);
    }
}

public sealed class StartupConfigurationTests
{
    [Theory]
    [InlineData("RateLimiting:ReadsGlobal", "0")]
    [InlineData("RateLimiting:ReadsPerClient", "-1")]
    [InlineData("RateLimiting:WritesGlobal", "0")]
    [InlineData("RateLimiting:WritesPerClient", "0")]
    [InlineData("RateLimiting:WindowSeconds", "0")]
    [InlineData("ForwardedHeaders:KnownProxies:0", "not-an-address")]
    public void InvalidOperationalSettings_FailStartup(string key, string value)
    {
        StartupFailure("Development", new() { [key] = value });
    }

    private static Exception StartupFailure(string environment, Dictionary<string, string?> settings)
    {
        using var factory = new BoardApiFactory(settings, environment);
        return Assert.ThrowsAny<Exception>(() => factory.CreateClient());
    }

    private static string AllMessages(Exception ex)
    {
        var messages = new List<string>();
        for (Exception? e = ex; e is not null; e = e.InnerException) messages.Add(e.Message);
        return string.Join(" | ", messages);
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void InMemoryMode_OutsideDevelopment_FailsStartup(string environment)
    {
        var ex = StartupFailure(environment, new() { ["Storage:Mode"] = "InMemory" });
        Assert.Contains("only allowed in the Development environment", AllMessages(ex));
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Development")]
    public void CosmosMode_WithoutConfiguration_FailsStartup_NoSilentFallback(string environment)
    {
        var ex = StartupFailure(environment, new() { ["Storage:Mode"] = "Cosmos" });
        var message = AllMessages(ex);
        Assert.Contains("Cosmos__Endpoint", message);
        Assert.Contains("Cosmos__Database", message);
        Assert.Contains("Cosmos__Container", message);
    }

    [Fact]
    public void CosmosMode_WithHttpEndpoint_FailsStartup()
    {
        var ex = StartupFailure("Production", new()
        {
            ["Storage:Mode"] = "Cosmos",
            ["Cosmos:Endpoint"] = "http://example.documents.azure.com/",
            ["Cosmos:Database"] = "db",
            ["Cosmos:Container"] = "c",
        });
        Assert.Contains("Cosmos__Endpoint", AllMessages(ex));
    }

    [Fact]
    public void UnknownStorageMode_FailsStartup()
    {
        StartupFailure("Development", new() { ["Storage:Mode"] = "File" });
    }

    [Fact]
    public async Task CosmosMode_Configured_StartsAndRegistersCosmosRepository()
    {
        using var factory = new BoardApiFactory(new Dictionary<string, string?>
        {
            ["Storage:Mode"] = "Cosmos",
            ["Cosmos:Endpoint"] = "https://example.documents.azure.com:443/",
            ["Cosmos:Database"] = "todo",
            ["Cosmos:Container"] = "boards",
        }, "Production");
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);
        // Resolving the repository constructs the client lazily without network calls.
        var repository = factory.Services.GetService(typeof(IBoardRepository));
        Assert.IsType<CosmosBoardRepository>(repository);
    }
}
