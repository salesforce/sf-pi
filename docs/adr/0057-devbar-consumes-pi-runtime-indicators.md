# ADR 0057: DevBar consumes Pi runtime indicators without cloning the Pi footer

Status: accepted

SF DevBar remains the default Salesforce footer/shell because it carries Salesforce org, project, LSP, Slack, and SF LLM Gateway operational context that Pi's default footer does not own. DevBar may consume stable Pi-owned runtime facts such as model, thinking, context usage, and future cache stats, but it must not clone Pi's whole default footer or reverse-engineer session internals; cache visibility should wait for a public Pi accessor such as `footerData.getCacheStats()` or `ctx.getCacheUsage()`.

Pi 0.81 follow-up: expanded assistant/tool/compaction/branch-summary usage and cache accounting stays Pi-owned. SF DevBar will preserve nullable `ctx.getContextUsage().percent` instead of recomputing unknown usage as zero, may display Pi's public session name, and will not reproduce native usage totals until Pi exposes a read-only extension statistic or composable footer seam.
