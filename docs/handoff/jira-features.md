## Outcome

The repository gains the product its README describes: an MCP server for Jira health that publishes five read-only tools, with the health rules, the REST client and the configuration behind them.

## The five tools

| Tool | What it finds |
| --- | --- |
| `jira_find_orphaned_issues` | Open issues that stand on their own: no parent, no epic, no link, and nothing pointing at them. |
| `jira_find_missing_release_versions` | An issue names a version the project does not have, or an issue ships in a release while its parent carries no version. |
| `jira_find_stale_blockers` | Open blockers that have not moved for longer than the threshold; high severity when the blocked work already ships. |
| `jira_find_broken_hierarchies` | A parent or epic that does not exist, a parent chain that loops, a hierarchy deeper than the limit. |
| `jira_health_summary` | Counts per category and severity, the findings to look at first, and a `healthy` / `needs-attention` status. |

## Scope

- `src/health/` — the rules and the summary. Pure functions over normalized issues: the reference time is a parameter, and nothing here reads a clock, the environment or the network.
- `src/jira/` — the REST client and the normalizer. The client owns authentication, timeouts, pagination, the fallback to the earlier search endpoint and the mapping of failures.
- `src/config.ts` — the configuration, read from the environment only, and `redact`, which every message that could carry a token goes through.
- `src/server.ts` — the five tools. `src/index.ts` speaks MCP over the standard input and output.
- `src/testing/`, `e2e/` — the shared fixtures and the end-to-end smoke test.
- `README.md`, `AGENTS.md`, `CHANGELOG.md` — the tools, the repository rules (including that the server only reads and that no test reaches a live Jira), and the changelog entry.

The branch also carries the scaffold and the two fixes from the earlier review of it: the shebang and the real-path entry-point check that make the published `bin` entry runnable, the publish build in the validation, and the test runner that lists the test files instead of globbing them.

## Acceptance evidence

- `npm ci` succeeds from the committed lockfile.
- `npm run check` exits 0: type check, publish build, 44 unit tests, 2 end-to-end tests, 0 failing.
- The end-to-end test spawns the built server, speaks MCP over its standard input and output, and drives all five tools against a mock Jira on loopback.
- The unit tests drive the real request-building code against an injected `fetch`, including the pagination, the endpoint fallback, the error mapping and the redaction.
- Mutation checks during the build: a changed switch case, a moved error stream and a deliberately failing test file were each caught by the validation.

## Validation

```
npm ci
npm run check
```

Tested revision: `b249e57a71511ac73552a5bffefa0e1e2b4f029e` (branch `feat/bootstrap-scaffold`, base `main`).

## Risk

The rules encode judgements about what "orphaned", "stale" and "broken" mean. They are stated in the README and in the code, and the thresholds are configurable, but a maintainer may want different definitions; each rule is a small function with its own tests, so changing one is a bounded change. The client targets the Jira Cloud REST API v3 and falls back to the earlier search endpoint for sites that do not know the current one; a Jira Server installation would need a different base path.
