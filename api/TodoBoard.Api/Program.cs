using Microsoft.AspNetCore.HttpOverrides;
using TodoBoard.Api.Http;
using TodoBoard.Api.Storage;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.AddServerHeader = false;
    // Defense in depth; PUT /api/board enforces the stricter documented limit itself.
    kestrel.Limits.MaxRequestBodySize = 1_048_576;
});

builder.Services.AddProblemDetails();
var storageMode = builder.Services.AddBoardStorage(builder.Configuration, builder.Environment);
builder.Services.AddBoardRateLimiting(builder.Configuration);
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    // Never trust arbitrary forwarded headers. Configure actual ingress proxy addresses explicitly.
    // Until configured, rate limits conservatively group clients by their connection peer.
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor;
    options.ForwardLimit = 1;
    foreach (var address in builder.Configuration.GetSection("ForwardedHeaders:KnownProxies").Get<string[]>() ?? [])
    {
        if (!System.Net.IPAddress.TryParse(address, out var proxy))
            throw new InvalidOperationException("ForwardedHeaders:KnownProxies must contain IP addresses.");
        options.KnownProxies.Add(proxy);
    }
});

var app = builder.Build();

if (storageMode == BoardStorageMode.InMemory)
{
    app.Logger.LogWarning("Board storage: Development-only IN-MEMORY mode. Data is not persisted or shared.");
}
else
{
    app.Logger.LogInformation("Board storage: Cosmos DB (managed identity).");
}

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.Use((context, next) =>
{
    context.Response.Headers.XContentTypeOptions = "nosniff";
    return next(context);
});
app.UseRateLimiter();

app.MapBoardApi();

app.Run();

public partial class Program;
