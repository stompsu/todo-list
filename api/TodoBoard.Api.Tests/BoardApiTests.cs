using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using TodoBoard.Api.Board;
using static TodoBoard.Api.Tests.Boards;

namespace TodoBoard.Api.Tests;

public sealed class BoardApiTests : IDisposable
{
    private readonly BoardApiFactory _factory = new();
    private readonly HttpClient _client;

    public BoardApiTests() => _client = _factory.CreateClient();

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }

    [Fact]
    public async Task Health_ReturnsHealthy()
    {
        var response = await _client.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertJsonEqual("""{"status":"healthy"}""", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Get_BeforeFirstSave_ReturnsEmptyBoardWithInitialETag()
    {
        var response = await _client.GetAsync("/api/board");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("\"empty\"", ETagOf(response));
        Assert.True(response.Headers.CacheControl?.NoStore);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        AssertJsonEqual(Empty, await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Put_ThenGet_RoundTripsExactContractAndOrder()
    {
        var put = await Put(_client, Sample, "\"empty\"");
        Assert.Equal(HttpStatusCode.OK, put.StatusCode);
        var etag = ETagOf(put);
        Assert.NotEqual("\"empty\"", etag);
        var putBody = await put.Content.ReadAsStringAsync();
        AssertJsonEqual(Sample, putBody);

        var get = await _client.GetAsync("/api/board");
        Assert.Equal(etag, ETagOf(get));
        var getBody = await get.Content.ReadAsStringAsync();
        AssertJsonEqual(Sample, getBody);

        // Task array order is the persisted ordering; categoryId null must be present, not omitted.
        var tasks = JsonNode.Parse(getBody)!["tasks"]!.AsArray();
        Assert.Equal(["t2", "t1", "t3"], tasks.Select(t => (string)t!["id"]!));
        Assert.True(tasks[0]!.AsObject().ContainsKey("categoryId"));
        Assert.Null(tasks[0]!["categoryId"]);
        Assert.Equal(["version", "categories", "tasks"], JsonNode.Parse(getBody)!.AsObject().Select(p => p.Key));
    }

    [Fact]
    public async Task Board_IsSharedAcrossClients_AndSequentialSavesChainETags()
    {
        using var other = _factory.CreateClient();
        var first = await Put(_client, WithTask("from A"), "\"empty\"");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        var seenByB = await other.GetAsync("/api/board");
        AssertJsonEqual(WithTask("from A"), await seenByB.Content.ReadAsStringAsync());

        var second = await Put(other, WithTask("from B"), ETagOf(seenByB));
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.NotEqual(ETagOf(first), ETagOf(second));

        var seenByA = await _client.GetAsync("/api/board");
        AssertJsonEqual(WithTask("from B"), await seenByA.Content.ReadAsStringAsync());
        Assert.Equal(ETagOf(second), ETagOf(seenByA));
    }

    [Fact]
    public async Task Put_WithoutIfMatch_Returns428AndDoesNotSave()
    {
        var response = await Put(_client, Sample, ifMatch: null);

        Assert.Equal(HttpStatusCode.PreconditionRequired, response.StatusCode);
        Assert.Equal(428, (int)(await Problem(response))["status"]!);
        AssertJsonEqual(Empty, await (await _client.GetAsync("/api/board")).Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("*")]
    [InlineData("W/\"empty\"")]
    [InlineData("empty")]
    [InlineData("\"a\", \"b\"")]
    public async Task Put_WithUnusableIfMatch_Returns400(string ifMatch)
    {
        var response = await Put(_client, Sample, ifMatch);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        await Problem(response);
    }

    [Fact]
    public async Task Put_WithStaleETag_Returns412AndKeepsNewerData()
    {
        var v1 = await Put(_client, WithTask("v1"), "\"empty\"");
        var v2 = await Put(_client, WithTask("v2"), ETagOf(v1));
        Assert.Equal(HttpStatusCode.OK, v2.StatusCode);

        var stale = await Put(_client, WithTask("stale"), ETagOf(v1));
        Assert.Equal(HttpStatusCode.PreconditionFailed, stale.StatusCode);
        var problem = await Problem(stale);
        Assert.Equal(412, (int)problem["status"]!);

        var initialAgain = await Put(_client, WithTask("recreate"), "\"empty\"");
        Assert.Equal(HttpStatusCode.PreconditionFailed, initialAgain.StatusCode);

        var unknown = await Put(_client, WithTask("unknown"), "\"never-issued\"");
        Assert.Equal(HttpStatusCode.PreconditionFailed, unknown.StatusCode);

        var current = await _client.GetAsync("/api/board");
        Assert.Equal(ETagOf(v2), ETagOf(current));
        AssertJsonEqual(WithTask("v2"), await current.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ConcurrentWriters_WithSameETag_ExactlyOneWins()
    {
        var baseline = await Put(_client, WithTask("base"), "\"empty\"");
        var etag = ETagOf(baseline);

        var attempts = Enumerable.Range(0, 12).Select(async i =>
        {
            using var client = _factory.CreateClient();
            var response = await Put(client, WithTask($"writer {i}"), etag);
            return (i, response.StatusCode, Body: await response.Content.ReadAsStringAsync(),
                ETag: response.Headers.ETag?.ToString());
        });
        var results = await Task.WhenAll(attempts);

        var winners = results.Where(r => r.StatusCode == HttpStatusCode.OK).ToList();
        Assert.Single(winners);
        Assert.All(results.Except(winners), r => Assert.Equal(HttpStatusCode.PreconditionFailed, r.StatusCode));

        var final = await _client.GetAsync("/api/board");
        Assert.Equal(winners[0].ETag, ETagOf(final));
        AssertJsonEqual(winners[0].Body, await final.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task ConcurrentInitialCreates_ExactlyOneWins()
    {
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(i => Put(_client, WithTask($"first {i}"), "\"empty\"")));
        Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(7, results.Count(r => r.StatusCode == HttpStatusCode.PreconditionFailed));
    }

    public static TheoryData<string, string> InvalidBodies => new()
    {
        { "null", "$" },
        { "[]", "" },
        { "{}", "" },
        { "not json", "" },
        { """{"version":1,"categories":[],"tasks":[],}""", "" },
        { """{"version":2,"categories":[],"tasks":[]}""", "version" },
        { """{"version":"1","categories":[],"tasks":[]}""", "" },
        { """{"version":1.5,"categories":[],"tasks":[]}""", "" },
        { """{"version":null,"categories":[],"tasks":[]}""", "version" },
        { """{"version":1,"categories":null,"tasks":[]}""", "categories" },
        { """{"version":1,"categories":[],"tasks":null}""", "tasks" },
        { """{"version":1,"categories":[],"tasks":{}}""", "" },
        { """{"version":1,"categories":[],"tasks":[],"extra":true}""", "" },
        { """{"version":1,"version":1,"categories":[],"tasks":[]}""", "" },
        { """{"Version":1,"categories":[],"tasks":[]}""", "" },
        { """{"version":1,"categories":[null],"tasks":[]}""", "categories[0]" },
        { """{"version":1,"categories":[{"id":"c1"}],"tasks":[]}""", "" },
        { """{"version":1,"categories":[{"id":"","name":"x"}],"tasks":[]}""", "categories[0].id" },
        { """{"version":1,"categories":[{"id":"c","name":"   "}],"tasks":[]}""", "categories[0].name" },
        { """{"version":1,"categories":[{"id":"c","name":null}],"tasks":[]}""", "categories[0].name" },
        { """{"version":1,"categories":[{"id":"c","name":1}],"tasks":[]}""", "" },
        { """{"version":1,"categories":[{"id":"c","name":"a"},{"id":"c","name":"b"}],"tasks":[]}""", "categories[1].id" },
        { """{"version":1,"categories":[],"tasks":[null]}""", "tasks[0]" },
        { """{"version":1,"categories":[],"tasks":[{"id":"t","title":"x","description":"","color":"#000000","status":"todo"}]}""", "" },
        { """{"version":1,"categories":[],"tasks":[{"id":"t","title":"x","description":null,"categoryId":null,"color":"#000000","status":"todo"}]}""", "tasks[0].description" },
        { """{"version":1,"categories":[],"tasks":[{"id":"t","title":" ","description":"","categoryId":null,"color":"#000000","status":"todo"}]}""", "tasks[0].title" },
        { """{"version":1,"categories":[],"tasks":[{"id":"t","title":"x","description":"","categoryId":"missing","color":"#000000","status":"todo"}]}""", "tasks[0].categoryId" },
        { """{"version":1,"categories":[],"tasks":[{"id":"t","title":"x","description":"","categoryId":"","color":"#000000","status":"todo"}]}""", "tasks[0].categoryId" },
        { """{"version":1,"categories":[],"tasks":[{"id":"t","title":"x","description":"","categoryId":null,"color":"red","status":"todo"}]}""", "tasks[0].color" },
        { """{"version":1,"categories":[],"tasks":[{"id":"t","title":"x","description":"","categoryId":null,"color":"#000000","status":"done"}]}""", "tasks[0].status" },
        { """{"version":1,"categories":[],"tasks":[{"id":"t","title":"x","description":"","categoryId":null,"color":"#000000","status":"Todo"}]}""", "tasks[0].status" },
        { """{"version":1,"categories":[],"tasks":[{"id":"t","title":"a","description":"","categoryId":null,"color":"#000000","status":"todo"},{"id":"t","title":"b","description":"","categoryId":null,"color":"#000000","status":"todo"}]}""", "tasks[1].id" },
        { """{"version":1,"categories":[],"tasks":[{"id":"t","title":"x","description":"","categoryId":null,"color":"#000000","status":"todo","order":1}]}""", "" },
    };

    [Theory]
    [MemberData(nameof(InvalidBodies))]
    public async Task Put_InvalidOrNullData_Returns400AndDoesNotSave(string body, string expectedErrorKey)
    {
        var response = await Put(_client, body, "\"empty\"");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await Problem(response);
        if (expectedErrorKey.Length > 0)
        {
            Assert.True(problem["errors"]!.AsObject().ContainsKey(expectedErrorKey),
                $"Expected error for '{expectedErrorKey}' in {problem.ToJsonString()}");
        }
        Assert.DoesNotContain("TodoBoard.Api", problem.ToJsonString()); // no internal type names leak

        var current = await _client.GetAsync("/api/board");
        Assert.Equal("\"empty\"", ETagOf(current));
    }

    [Fact]
    public async Task Put_EmptyBody_Returns400()
    {
        var response = await Put(_client, "", "\"empty\"");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Put_NonJsonContentType_Returns415()
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, "/api/board")
        {
            Content = new StringContent(Empty, Encoding.UTF8, "text/plain"),
        };
        request.Headers.TryAddWithoutValidation("If-Match", "\"empty\"");
        var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }

    [Theory]
    [InlineData(BoardLimits.MaxTaskTitleLength, HttpStatusCode.OK)]
    [InlineData(BoardLimits.MaxTaskTitleLength + 1, HttpStatusCode.BadRequest)]
    public async Task Put_TitleLengthLimit(int length, HttpStatusCode expected)
    {
        var response = await Put(_client, WithTask(new string('x', length)), "\"empty\"");
        Assert.Equal(expected, response.StatusCode);
    }

    [Fact]
    public async Task Put_TooManyTasks_Returns400()
    {
        var response = await Put(_client, BuildBoard(BoardLimits.MaxTasks + 1, description: ""), "\"empty\"");
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.True((await Problem(response))["errors"]!.AsObject().ContainsKey("tasks"));
    }

    [Fact]
    public async Task Put_MaximumTaskCountWithinPayloadLimit_Succeeds()
    {
        var body = BuildBoard(BoardLimits.MaxTasks, description: new string('d', 300));
        Assert.True(Encoding.UTF8.GetByteCount(body) < BoardLimits.MaxRequestBodyBytes);
        var response = await Put(_client, body, "\"empty\"");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Put_BodyOverOneMegabyte_Returns413()
    {
        var body = BuildBoard(BoardLimits.MaxTasks, description: new string('d', 600));
        Assert.True(Encoding.UTF8.GetByteCount(body) > BoardLimits.MaxRequestBodyBytes);

        var response = await Put(_client, body, "\"empty\"");
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        await Problem(response);
    }

    [Fact]
    public async Task Put_ChunkedBodyOverLimit_Returns413()
    {
        var bytes = Encoding.UTF8.GetBytes(BuildBoard(BoardLimits.MaxTasks, description: new string('d', 600)));
        using var request = new HttpRequestMessage(HttpMethod.Put, "/api/board")
        {
            Content = new StreamContent(new NonSeekableStream(bytes)),
        };
        request.Content.Headers.ContentType = new("application/json");
        request.Headers.TransferEncodingChunked = true;
        request.Headers.TryAddWithoutValidation("If-Match", "\"empty\"");

        var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    }

    [Fact]
    public async Task Put_DocumentThatWouldExceedStorageLimit_Returns413()
    {
        // Astral-plane characters are 4 bytes raw in the request but are escaped (\uXXXX\uXXXX, 12 bytes) when stored.
        var emojiDescription = string.Concat(Enumerable.Repeat("\U0001F600", BoardLimits.MaxTaskDescriptionLength / 2));
        var body = BuildBoard(450, "EMOJI").Replace("EMOJI", emojiDescription);
        Assert.True(Encoding.UTF8.GetByteCount(body) < BoardLimits.MaxRequestBodyBytes);

        var response = await Put(_client, body, "\"empty\"");
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("\"empty\"", ETagOf(await _client.GetAsync("/api/board")));
    }

    [Fact]
    public async Task UnknownApiRoute_ReturnsProblem404()
    {
        var response = await _client.GetAsync("/api/nope");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        await Problem(response);
    }

    private static string BuildBoard(int taskCount, string description)
    {
        var tasks = Enumerable.Range(0, taskCount).Select(i => new JsonObject
        {
            ["id"] = $"task-{i}",
            ["title"] = $"Task {i}",
            ["description"] = description,
            ["categoryId"] = null,
            ["color"] = "#336699",
            ["status"] = "todo",
        });
        return new JsonObject
        {
            ["version"] = 1,
            ["categories"] = new JsonArray(),
            ["tasks"] = new JsonArray(tasks.ToArray<JsonNode?>()),
        }.ToJsonString(new System.Text.Json.JsonSerializerOptions
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        });
    }

    private sealed class NonSeekableStream(byte[] data) : MemoryStream(data)
    {
        public override bool CanSeek => false;
        public override long Length => throw new NotSupportedException();
    }
}
