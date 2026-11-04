using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace TodoBoard.Api.Http;

public sealed class BoardRateLimitOptions
{
    public const string Section = "RateLimiting";

    public int WindowSeconds { get; set; } = 60;
    /// <summary>GET/HEAD requests per client IP per window.</summary>
    public int ReadsPerClient { get; set; } = 120;
    /// <summary>Reads across all clients per process per window.</summary>
    public int ReadsGlobal { get; set; } = 1_200;
    /// <summary>Write requests per client IP per window.</summary>
    public int WritesPerClient { get; set; } = 30;
    /// <summary>Write requests across all clients per window (caps Cosmos cost if client IPs are spoofed or shared).</summary>
    public int WritesGlobal { get; set; } = 300;
}

public static class RateLimiting
{
    public static IServiceCollection AddBoardRateLimiting(this IServiceCollection services, IConfiguration configuration)
    {
        var options = configuration.GetSection(BoardRateLimitOptions.Section).Get<BoardRateLimitOptions>() ?? new();
        if (options.WindowSeconds < 1 || options.ReadsPerClient < 1 || options.ReadsGlobal < 1 ||
            options.WritesPerClient < 1 || options.WritesGlobal < 1)
        {
            throw new InvalidOperationException("RateLimiting settings must all be positive integers.");
        }
        var window = TimeSpan.FromSeconds(options.WindowSeconds);

        static bool IsExempt(HttpContext c) => c.Request.Path.StartsWithSegments("/api/health");
        static bool IsRead(HttpContext c) => HttpMethods.IsGet(c.Request.Method) || HttpMethods.IsHead(c.Request.Method);
        FixedWindowRateLimiterOptions Window(int permits) =>
            new() { PermitLimit = permits, Window = window, QueueLimit = 0, AutoReplenishment = true };

        var perClient = PartitionedRateLimiter.Create<HttpContext, string>(c =>
        {
            if (IsExempt(c)) return RateLimitPartition.GetNoLimiter("exempt");
            var ip = c.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            return IsRead(c)
                ? RateLimitPartition.GetFixedWindowLimiter("r:" + ip, _ => Window(options.ReadsPerClient))
                : RateLimitPartition.GetFixedWindowLimiter("w:" + ip, _ => Window(options.WritesPerClient));
        });
        var global = PartitionedRateLimiter.Create<HttpContext, string>(c =>
            IsExempt(c)
                ? RateLimitPartition.GetNoLimiter("none")
                : IsRead(c)
                    ? RateLimitPartition.GetFixedWindowLimiter("global-reads", _ => Window(options.ReadsGlobal))
                    : RateLimitPartition.GetFixedWindowLimiter("global-writes", _ => Window(options.WritesGlobal)));

        services.AddRateLimiter(limiter =>
        {
            limiter.GlobalLimiter = PartitionedRateLimiter.CreateChained(perClient, global);
            limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            limiter.OnRejected = async (context, cancellationToken) =>
            {
                var http = context.HttpContext;
                var retry = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var after) ? after : window;
                http.Response.Headers.RetryAfter =
                    Math.Max(1, (int)Math.Ceiling(retry.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
                http.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("TodoBoard.Api.RateLimiting")
                    .LogWarning("Rate limit exceeded for {Method} {Path}.", http.Request.Method, http.Request.Path);

                var problems = http.RequestServices.GetRequiredService<IProblemDetailsService>();
                await problems.WriteAsync(new ProblemDetailsContext
                {
                    HttpContext = http,
                    ProblemDetails =
                    {
                        Status = StatusCodes.Status429TooManyRequests,
                        Title = "Too many requests.",
                        Detail = "Nothing was saved. Wait for the Retry-After period and try again.",
                    },
                });
            };
        });
        return services;
    }
}
