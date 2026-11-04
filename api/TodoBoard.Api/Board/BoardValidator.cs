using System.Text.RegularExpressions;

namespace TodoBoard.Api.Board;

public sealed record BoardValidationResult(BoardData? Board, IReadOnlyDictionary<string, string[]> Errors)
{
    public bool IsValid => Board is not null;
}

/// <summary>
/// Server-side equivalent of <c>parseBoardData</c> in <c>src/lib/storage.ts</c>, plus size/count limits.
/// Rules: version must be 1; ids non-empty; category name / task title not blank; description is a string;
/// categoryId is null or the id of an existing category; color is #RRGGBB; status is todo|in-progress|completed;
/// category and task ids are unique (ordinal). Category names are not required to be unique, matching import.
/// </summary>
public static partial class BoardValidator
{
    public static readonly IReadOnlySet<string> Statuses =
        new HashSet<string>(["todo", "in-progress", "completed"], StringComparer.Ordinal);

    [GeneratedRegex("\\A#[0-9a-fA-F]{6}\\z", RegexOptions.CultureInvariant)]
    private static partial Regex ColorPattern();

    public static BoardValidationResult Validate(BoardInput? input)
    {
        var errors = new ErrorCollector();
        if (input is null)
        {
            errors.Add("$", "The board must be a JSON object.");
            return errors.ToResult();
        }

        if (input.Version != BoardData.CurrentVersion)
        {
            errors.Add("version", "version must be 1.");
        }

        var categories = new List<BoardCategory>();
        var categoryIds = new HashSet<string>(StringComparer.Ordinal);
        if (input.Categories is null)
        {
            errors.Add("categories", "categories must be an array.");
        }
        else if (input.Categories.Count > BoardLimits.MaxCategories)
        {
            errors.Add("categories", $"categories may contain at most {BoardLimits.MaxCategories} items.");
        }
        else
        {
            for (var i = 0; i < input.Categories.Count; i++)
            {
                var path = $"categories[{i}]";
                var category = input.Categories[i];
                if (category is null)
                {
                    errors.Add(path, "Each category must be an object.");
                    continue;
                }

                var ok = CheckId(errors, $"{path}.id", category.Id);
                ok &= CheckText(errors, $"{path}.name", category.Name, BoardLimits.MaxCategoryNameLength, allowBlank: false);
                if (category.Id is { Length: > 0 } id && !categoryIds.Add(id))
                {
                    errors.Add($"{path}.id", "Category ids must be unique.");
                    ok = false;
                }
                if (ok) categories.Add(new BoardCategory(category.Id!, category.Name!));
            }
        }

        var tasks = new List<BoardTask>();
        var taskIds = new HashSet<string>(StringComparer.Ordinal);
        if (input.Tasks is null)
        {
            errors.Add("tasks", "tasks must be an array.");
        }
        else if (input.Tasks.Count > BoardLimits.MaxTasks)
        {
            errors.Add("tasks", $"tasks may contain at most {BoardLimits.MaxTasks} items.");
        }
        else
        {
            for (var i = 0; i < input.Tasks.Count; i++)
            {
                var path = $"tasks[{i}]";
                var task = input.Tasks[i];
                if (task is null)
                {
                    errors.Add(path, "Each task must be an object.");
                    continue;
                }

                var ok = CheckId(errors, $"{path}.id", task.Id);
                ok &= CheckText(errors, $"{path}.title", task.Title, BoardLimits.MaxTaskTitleLength, allowBlank: false);
                ok &= CheckText(errors, $"{path}.description", task.Description, BoardLimits.MaxTaskDescriptionLength, allowBlank: true);

                if (task.Id is { Length: > 0 } id && !taskIds.Add(id))
                {
                    errors.Add($"{path}.id", "Task ids must be unique.");
                    ok = false;
                }
                // Only check references once categories parsed; null means "uncategorized".
                if (task.CategoryId is not null && input.Categories is not null && !categoryIds.Contains(task.CategoryId))
                {
                    errors.Add($"{path}.categoryId", "categoryId must be null or the id of an existing category.");
                    ok = false;
                }
                if (task.Color is null || !ColorPattern().IsMatch(task.Color))
                {
                    errors.Add($"{path}.color", "color must be a hex color in the form #RRGGBB.");
                    ok = false;
                }
                if (task.Status is null || !Statuses.Contains(task.Status))
                {
                    errors.Add($"{path}.status", "status must be one of: todo, in-progress, completed.");
                    ok = false;
                }

                if (ok)
                {
                    tasks.Add(new BoardTask(task.Id!, task.Title!, task.Description!, task.CategoryId, task.Color!, task.Status!));
                }
            }
        }

        return errors.Count > 0
            ? errors.ToResult()
            : new BoardValidationResult(new BoardData(BoardData.CurrentVersion, categories, tasks), new Dictionary<string, string[]>());
    }

    private static bool CheckId(ErrorCollector errors, string path, string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            errors.Add(path, "id must be a non-empty string.");
            return false;
        }
        if (value.Length > BoardLimits.MaxIdLength)
        {
            errors.Add(path, $"id must be at most {BoardLimits.MaxIdLength} characters.");
            return false;
        }
        return true;
    }

    private static bool CheckText(ErrorCollector errors, string path, string? value, int maxLength, bool allowBlank)
    {
        var name = path[(path.LastIndexOf('.') + 1)..];
        if (value is null)
        {
            errors.Add(path, $"{name} must be a string.");
            return false;
        }
        if (!allowBlank && IsBlank(value))
        {
            errors.Add(path, $"{name} must not be blank.");
            return false;
        }
        if (value.Length > maxLength)
        {
            errors.Add(path, $"{name} must be at most {maxLength} characters.");
            return false;
        }
        return true;
    }

    /// <summary>Approximates JavaScript <c>String.prototype.trim().length === 0</c>.</summary>
    private static bool IsBlank(string value)
    {
        foreach (var c in value)
        {
            if (!char.IsWhiteSpace(c) && c != '\uFEFF') return false;
        }
        return true;
    }

    private sealed class ErrorCollector
    {
        private readonly Dictionary<string, List<string>> _errors = new(StringComparer.Ordinal);
        private int _total;

        public int Count => _total;

        public void Add(string path, string message)
        {
            _total++;
            if (_errors.Count >= BoardLimits.MaxReportedErrors && !_errors.ContainsKey(path)) return;
            if (!_errors.TryGetValue(path, out var list)) _errors[path] = list = [];
            list.Add(message);
        }

        public BoardValidationResult ToResult() =>
            new(null, _errors.ToDictionary(e => e.Key, e => e.Value.ToArray(), StringComparer.Ordinal));
    }
}
