# SF Docs caches only the collection catalog

SF Docs may cache the docs-service collection catalog locally to make collection discovery, settings, and repeated `collections` calls fast, but it does not cache search results, synthesized answers, fetched document bodies, or citations. This keeps the extension responsive without creating a local documentation index, stale source corpus, or broader privacy/storage surface.
