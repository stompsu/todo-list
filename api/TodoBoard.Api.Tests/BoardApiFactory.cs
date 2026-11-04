using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using TodoBoard.Api.Storage;

namespace TodoBoard.Api.Tests;

/// <summary>
/// Hosts the real API pipeline. Defaults to Development + explicit InMemory storage with generous rate limits;
/// tests may override settings, environment, or substitute the repository.
/// </summary>
public sealed class BoardApiFactory(
    IDictionary<string, string?>? settings = null,
    string environment = "Development",
    IBoardRepository? repository = null) : WebApplicationFactory<Program>
{
    public static readonly IReadOnlyDictionary<string, string?> Defaults = new Dictionary<string, string?>
    {
        ["Storage:Mode"] = "InMemory",
        ["RateLimiting:ReadsPerClient"] = "100000",
        ["RateLimiting:ReadsGlobal"] = "100000",
        ["RateLimiting:WritesPerClient"] = "100000",
        ["RateLimiting:WritesGlobal"] = "100000",
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment);
        var merged = new Dictionary<string, string?>(Defaults);
        foreach (var (key, value) in settings ?? new Dictionary<string, string?>()) merged[key] = value;
        foreach (var (key, value) in merged)
        {
            if (value is not null) builder.UseSetting(key, value);
        }

        if (repository is not null)
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IBoardRepository>();
                services.AddSingleton(repository);
            });
        }
    }
}
