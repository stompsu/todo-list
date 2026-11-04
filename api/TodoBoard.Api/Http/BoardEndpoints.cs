using System.Text.Json;
using Microsoft.AspNetCore.Http.HttpResults;
using TodoBoard.Api.Board;
using TodoBoard.Api.Storage;

namespace TodoBoard.Api.Http;

public static class BoardEndpoints
{
    public static IEndpointRouteBuilder MapBoardApi(this IEndpointRouteBuilder app)
    {
        var api = app.MapGroup("/api");

        api.MapGet("/health", (HttpContext context) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            return TypedResults.Ok(new { status = "healthy" });
        });

        api.MapGet("/board", GetBoard);
        api.MapPut("/board", PutBoard);
        return app;
    }

    private static async Task<IResult> GetBoard(HttpContext context, IBoardRepository repository, ILoggerFactory loggers)
    {
        var logger = loggers.CreateLogger(typeof(BoardEndpoints).FullName!);
        try
        {
            var snapshot = await repository.GetAsync(context.RequestAborted);
            return BoardResponse(context, snapshot);
        }
        catch (Exception ex) when (TryMapStorageException(ex, logger, context, out var problem))
        {
            return problem!;
        }
    }

    private static async Task<IResult> PutBoard(HttpContext context, IBoardRepository repository, ILoggerFactory loggers)
    {
        var logger = loggers.CreateLogger(typeof(BoardEndpoints).FullName!);
        var request = context.Request;

        var ifMatch = IfMatchParser.Parse(request.Headers.IfMatch);
        switch (ifMatch.Status)
        {
            case IfMatchStatus.Missing:
                return Problem(StatusCodes.Status428PreconditionRequired, "If-Match header required.",
                    "Send the ETag from GET /api/board in an If-Match header. Use \"empty\" only when the board has never been saved.");
            case IfMatchStatus.Invalid:
                return Problem(StatusCodes.Status400BadRequest, "Invalid If-Match header.", ifMatch.Error!);
        }

        if (!request.HasJsonContentType())
        {
            return Problem(StatusCodes.Status415UnsupportedMediaType, "Unsupported media type.",
                "Send the board as Content-Type: application/json.");
        }

        var (body, bodyError) = await ReadBoundedBody(request);
        if (bodyError is not null) return bodyError;

        BoardInput? input;
        try
        {
            input = JsonSerializer.Deserialize<BoardInput>(body!, BoardJson.Request);
        }
        catch (JsonException ex)
        {
            var location = string.IsNullOrEmpty(ex.Path) ? "" : $" near {ex.Path}";
            return Problem(StatusCodes.Status400BadRequest, "Invalid board JSON.",
                $"The request body is not a valid board{location}. Every contract property is required, values must have the " +
                "correct JSON types, and unknown or duplicate properties are not allowed.");
        }

        var validation = BoardValidator.Validate(input);
        if (!validation.IsValid)
        {
            return TypedResults.ValidationProblem(validation.Errors, title: "The board is invalid.");
        }

        try
        {
            var result = await repository.SaveAsync(validation.Board!, ifMatch.ETag!, context.RequestAborted);
            return result switch
            {
                SaveBoardResult.Saved saved => BoardResponse(context, saved.Snapshot),
                SaveBoardResult.PreconditionFailed => Problem(StatusCodes.Status412PreconditionFailed,
                    "The board was changed by someone else.",
                    "Your changes were not saved. Reload the board (GET /api/board), reapply your changes, and retry with the new ETag."),
                _ => throw new InvalidOperationException("Unknown save result."),
            };
        }
        catch (Exception ex) when (TryMapStorageException(ex, logger, context, out var problem))
        {
            return problem!;
        }
    }

    private static IResult BoardResponse(HttpContext context, BoardSnapshot snapshot)
    {
        context.Response.Headers.ETag = snapshot.ETag;
        context.Response.Headers.CacheControl = "no-store";
        return TypedResults.Json(snapshot.Board, BoardJson.Response);
    }

    private static async Task<(byte[]? Body, IResult? Error)> ReadBoundedBody(HttpRequest request)
    {
        var tooLarge = Problem(StatusCodes.Status413PayloadTooLarge, "Board too large.",
            $"The request body must be at most {BoardLimits.MaxRequestBodyBytes} bytes.");
        if (request.ContentLength > BoardLimits.MaxRequestBodyBytes) return (null, tooLarge);

        using var buffer = new MemoryStream();
        var chunk = new byte[16 * 1024];
        try
        {
            int read;
            while ((read = await request.Body.ReadAsync(chunk, request.HttpContext.RequestAborted)) > 0)
            {
                if (buffer.Length + read > BoardLimits.MaxRequestBodyBytes) return (null, tooLarge);
                buffer.Write(chunk, 0, read);
            }
        }
        catch (BadHttpRequestException ex)
        {
            return (null, ex.StatusCode == StatusCodes.Status413PayloadTooLarge
                ? tooLarge
                : Problem(ex.StatusCode, "Invalid request body.", "The request body could not be read."));
        }

        if (buffer.Length == 0)
        {
            return (null, Problem(StatusCodes.Status400BadRequest, "Invalid board JSON.", "The request body is empty."));
        }
        return (buffer.ToArray(), null);
    }

    private static bool TryMapStorageException(Exception ex, ILogger logger, HttpContext context, out IResult? problem)
    {
        switch (ex)
        {
            case BoardStorageUnavailableException unavailable:
                logger.LogError(ex, "Board storage unavailable for {Method} {Path}.", context.Request.Method, context.Request.Path);
                var seconds = (int)Math.Ceiling((unavailable.RetryAfter ?? TimeSpan.FromSeconds(5)).TotalSeconds);
                context.Response.Headers.RetryAfter = Math.Clamp(seconds, 1, 60).ToString(System.Globalization.CultureInfo.InvariantCulture);
                problem = Problem(StatusCodes.Status503ServiceUnavailable, "Board storage is temporarily unavailable.",
                    "The operation could not be confirmed. Reload the board before retrying; a write may have committed.");
                return true;
            case BoardDocumentTooLargeException tooLarge:
                logger.LogWarning("Rejected board: serialized document {Size} bytes exceeds limit.", tooLarge.Size);
                problem = Problem(StatusCodes.Status413PayloadTooLarge, "Board too large.",
                    $"The stored board must be at most {BoardLimits.MaxStoredDocumentBytes} bytes after serialization.");
                return true;
            case BoardStorageCorruptException:
                logger.LogCritical(ex, "Stored board document is invalid; it has been left untouched.");
                problem = Problem(StatusCodes.Status500InternalServerError, "Stored board could not be read.",
                    "The shared board data is invalid. It has not been changed.");
                return true;
            default:
                problem = null;
                return false;
        }
    }

    private static ProblemHttpResult Problem(int status, string title, string detail) =>
        TypedResults.Problem(statusCode: status, title: title, detail: detail);
}
