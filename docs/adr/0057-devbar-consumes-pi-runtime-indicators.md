# ADR 0057: DevBar consumes Pi runtime indicators without cloning the Pi footer

Status: accepted

SF DevBar remains the default Salesforce footer/shell because it carries Salesforce org, project, LSP, Slack, and SF LLM Gateway operational context that Pi's default footer does not own. DevBar may consume stable Pi-owned runtime facts such as model, thinking, context usage, and future cache stats, but it must not clone Pi's whole default footer or reverse-engineer session internals; cache visibility should wait for a public Pi accessor such as `footerData.getCacheStats()` or `ctx.getCacheUsage()`.
