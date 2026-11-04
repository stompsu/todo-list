using System.Text.Json.Serialization;

namespace TodoBoard.Api.Board;

/// <summary>Validated board, shape-identical to <c>BoardData</c> in <c>src/types/board.ts</c>.</summary>
public sealed record BoardData(
    [property: JsonPropertyName("version")] int Version,
    [property: JsonPropertyName("categories")] IReadOnlyList<BoardCategory> Categories,
    [property: JsonPropertyName("tasks")] IReadOnlyList<BoardTask> Tasks)
{
    public const int CurrentVersion = 1;

    public static BoardData Empty { get; } = new(CurrentVersion, [], []);
}

public sealed record BoardCategory(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name);

public sealed record BoardTask(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("description")] string Description,
    [property: JsonPropertyName("categoryId")] string? CategoryId,
    [property: JsonPropertyName("color")] string Color,
    [property: JsonPropertyName("status")] string Status);

/// <summary>
/// Untrusted request/stored shape. Every property is required to be present (matching the TypeScript
/// contract, where <c>categoryId</c> is <c>string | null</c>, not optional) but nullable so that
/// <see cref="BoardValidator"/> can report null values as validation errors instead of crashing.
/// </summary>
public sealed class BoardInput
{
    [JsonRequired, JsonPropertyName("version")] public int? Version { get; set; }
    [JsonRequired, JsonPropertyName("categories")] public List<CategoryInput?>? Categories { get; set; }
    [JsonRequired, JsonPropertyName("tasks")] public List<TaskInput?>? Tasks { get; set; }
}

public sealed class CategoryInput
{
    [JsonRequired, JsonPropertyName("id")] public string? Id { get; set; }
    [JsonRequired, JsonPropertyName("name")] public string? Name { get; set; }
}

public sealed class TaskInput
{
    [JsonRequired, JsonPropertyName("id")] public string? Id { get; set; }
    [JsonRequired, JsonPropertyName("title")] public string? Title { get; set; }
    [JsonRequired, JsonPropertyName("description")] public string? Description { get; set; }
    [JsonRequired, JsonPropertyName("categoryId")] public string? CategoryId { get; set; }
    [JsonRequired, JsonPropertyName("color")] public string? Color { get; set; }
    [JsonRequired, JsonPropertyName("status")] public string? Status { get; set; }
}
