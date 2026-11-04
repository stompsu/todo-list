using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;

namespace TodoBoard.Api.Http;

public enum IfMatchStatus { Valid, Missing, Invalid }

public readonly record struct IfMatchResult(IfMatchStatus Status, string? ETag = null, string? Error = null);

public static class IfMatchParser
{
    /// <summary>
    /// Requires exactly one strong, quoted entity tag (e.g. <c>"empty"</c> or the value of a previous ETag header).
    /// Wildcards and weak tags are rejected because they would allow blind overwrites of the shared board.
    /// </summary>
    public static IfMatchResult Parse(StringValues values)
    {
        var nonEmpty = values.Where(v => !string.IsNullOrWhiteSpace(v)).Select(v => v!).ToList();
        if (nonEmpty.Count == 0) return new(IfMatchStatus.Missing);

        if (!EntityTagHeaderValue.TryParseStrictList(nonEmpty, out var tags) || tags.Count != 1)
        {
            return new(IfMatchStatus.Invalid, Error: "If-Match must contain exactly one quoted ETag, e.g. If-Match: \"empty\".");
        }

        var tag = tags[0];
        if (tag.Equals(EntityTagHeaderValue.Any))
        {
            return new(IfMatchStatus.Invalid, Error: "If-Match: * is not allowed; send the ETag of the board you edited.");
        }
        if (tag.IsWeak)
        {
            return new(IfMatchStatus.Invalid, Error: "Weak ETags are not allowed in If-Match.");
        }
        return new(IfMatchStatus.Valid, tag.Tag.ToString());
    }
}
