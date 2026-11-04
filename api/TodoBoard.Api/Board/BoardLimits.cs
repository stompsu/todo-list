namespace TodoBoard.Api.Board;

/// <summary>Documented, public limits of the shared board API.</summary>
public static class BoardLimits
{
    /// <summary>Maximum accepted PUT /api/board request body (bytes). Larger bodies get 413.</summary>
    public const int MaxRequestBodyBytes = 1_000_000;

    /// <summary>Maximum serialized Cosmos document (bytes); below Cosmos' 2 MB item limit.</summary>
    public const int MaxStoredDocumentBytes = 1_500_000;

    public const int MaxCategories = 200;
    public const int MaxTasks = 2_000;

    public const int MaxIdLength = 100;
    /// <summary>Matches the frontend category name input (maxLength=40).</summary>
    public const int MaxCategoryNameLength = 40;
    /// <summary>Matches the frontend task title input (maxLength=120).</summary>
    public const int MaxTaskTitleLength = 120;
    /// <summary>Matches the frontend task description input (maxLength=1000).</summary>
    public const int MaxTaskDescriptionLength = 1_000;

    /// <summary>Maximum number of individual validation errors returned in one response.</summary>
    public const int MaxReportedErrors = 25;
}
