using Xunit;

// Test fixtures use isolated database files but SQLite's ClearAllPools operation is
// process-wide. Serial execution prevents one fixture's cleanup from invalidating
// another fixture's active native handle and makes the acceptance suite deterministic.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
