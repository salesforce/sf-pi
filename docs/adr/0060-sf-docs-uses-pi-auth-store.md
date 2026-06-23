# SF Docs uses Pi auth store for its docs credential

SF Docs stores its docs-service bearer credential in Pi's central auth store under provider id `sf-docs`, with `SF_DOCS_MCP_TOKEN` kept only as an automation fallback. This follows the single-place credential pattern used by other credentialed SF Pi integrations and avoids putting secrets in project files, extension settings, MCP config, or source-controlled docs.
