using TodoBoard.Api.Board;

namespace TodoBoard.Api.Storage;

/// <summary>
/// Process-local board store for Development and tests only. Startup refuses to register it in any other
/// environment. Data is lost on restart and is not shared between instances.
/// </summary>
public sealed class InMemoryBoardRepository : IBoardRepository
{
    private readonly Lock _gate = new();
    private BoardSnapshot? _current;
    private long _revision;

    public Task<BoardSnapshot> GetAsync(CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            return Task.FromResult(_current ?? new BoardSnapshot(BoardData.Empty, BoardETags.Initial));
        }
    }

    public Task<SaveBoardResult> SaveAsync(BoardData board, string ifMatch, CancellationToken cancellationToken)
    {
        // Same size rule as Cosmos so local behaviour matches production.
        _ = BoardDocument.Serialize(board);

        lock (_gate)
        {
            var currentETag = _current?.ETag ?? BoardETags.Initial;
            if (!string.Equals(currentETag, ifMatch, StringComparison.Ordinal))
            {
                return Task.FromResult<SaveBoardResult>(new SaveBoardResult.PreconditionFailed());
            }

            _revision++;
            _current = new BoardSnapshot(board, $"\"mem-{_revision}\"");
            return Task.FromResult<SaveBoardResult>(new SaveBoardResult.Saved(_current));
        }
    }
}
