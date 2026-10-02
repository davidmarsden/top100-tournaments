# Sync bridge verification

After deployment, run **Normal sync** from an existing saved bookmarklet on Soccer Manager. The public router should delegate to the Manager Lab router, and the public collector fallback should delegate to the Manager Lab collector while preserving the invocation token.

For a completed match with a report available, the staged `matchReplay` should contain `source.sourceKind`, `stats`, `tactics` and `matchReport`. A previously archived fixture should then stage as a changed `match_snapshot` instead of reporting no canonical difference.
