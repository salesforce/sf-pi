# SF Docs routes Developer reference lookups to LegacyDeveloper

SF Docs may transparently route high-confidence Salesforce developer reference lookups from the `developer` collection to `legacydeveloper` when current docs-service collection coverage indicates that reference material still lives in Atlas-backed legacy developer docs. The override is limited to reference intent, must be visible in the **Docs Query Plan** and structured tool details, and avoids adding a local documentation index or broader tool surface while improving common agent retrieval mistakes.
