using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace TodoBoard.Api.Tests;

public static class Boards
{
    public const string Empty = """{"version":1,"categories":[],"tasks":[]}""";

    public const string Sample = """
        {"version":1,
         "categories":[{"id":"c1","name":"Work"},{"id":"c2","name":"Home"}],
         "tasks":[
           {"id":"t2","title":"Second first","description":"","categoryId":null,"color":"#aabbcc","status":"todo"},
           {"id":"t1","title":"Write API","description":"Ünïcødé ✓ <b>&</b>","categoryId":"c1","color":"#00FF7f","status":"in-progress"},
           {"id":"t3","title":"Done","description":"multi\nline","categoryId":"c2","color":"#123456","status":"completed"}
         ]}
        """;

    public static string WithTask(string title) =>
        $$"""{"version":1,"categories":[],"tasks":[{"id":"t1","title":"{{title}}","description":"","categoryId":null,"color":"#000000","status":"todo"}]}""";

    public static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    public static async Task<HttpResponseMessage> Put(HttpClient client, string json, string? ifMatch)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, "/api/board") { Content = Json(json) };
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return await client.SendAsync(request);
    }

    public static string ETagOf(HttpResponseMessage response) =>
        response.Headers.ETag?.ToString() ?? throw new Xunit.Sdk.XunitException("Response has no ETag header.");

    public static void AssertJsonEqual(string expected, string actual) =>
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(expected), JsonNode.Parse(actual)),
            $"JSON differs.\nExpected: {expected}\nActual:   {actual}");

    public static async Task<JsonObject> Problem(HttpResponseMessage response)
    {
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
    }
}
