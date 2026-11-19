# sureforge-jira-mcp

MCP server for Jira health: finds orphaned issues, missing release versions, stale blockers and broken hierarchies.

The server only reads. It never changes an issue, and it never writes to Jira.

## The tools

| Tool | What it finds |
| --- | --- |
| `jira_find_orphaned_issues` | Open issues that stand on their own: no parent, no epic, no link to another issue, and nothing pointing at them. |
| `jira_find_missing_release_versions` | Issues whose release version is missing or wrong: an issue names a version the project does not have, or an issue ships in a release while its parent carries no version. |
| `jira_find_stale_blockers` | Open issues that block other issues and have not been updated for the staleness threshold or longer. A blocker of work that already ships is reported as high severity. |
| `jira_find_broken_hierarchies` | Broken issue hierarchies: a parent or epic that does not exist, a parent chain that loops, and a hierarchy deeper than the depth limit. |
| `jira_health_summary` | The aggregate view: the number of findings per category and severity, the findings to look at first, and a status of `healthy` or `needs-attention`. |

Every tool takes an optional `projectKey`, an optional `limit`, and the
thresholds that apply to it (`staleDays`, `maxDepth`). The findings are
ordered worst first.

Every tool result carries `issuesExamined`, the number of issues it looked
at. A listing reads at most 2000 issues per project. When the listing may be
missing issues the result carries `truncated: true`, and `issuesDropped`
(which names how many issues the listing left out - the ones the site
returned without a key, and the ones the issue cap cut off)
names how many issues the site returned without a key. A parent or epic that
is not in an incomplete listing is reported as "not found in the listing"
rather than as a broken hierarchy, and an issue that nothing in an incomplete
listing points at is reported as an orphan with a lower severity and a hedged
detail, because a partial listing cannot prove that an issue does not exist.
The same holds for the epic relation: when a site refuses the Epic Link field
the result carries `epicLinkKnown: false`, and the findings that would state
that an issue has no epic are hedged and lower in severity instead.

## Configuration

The server reads its configuration from the environment. Nothing is written to
disk and no credential is ever committed.

| Variable | Required | Meaning |
| --- | --- | --- |
| `JIRA_BASE_URL` | yes | The Jira site, for example `https://example.atlassian.net`. `https` is required, except for a loopback address, so a local mock can be used. |
| `JIRA_EMAIL` | yes | The email address of the account that reads the project. |
| `JIRA_API_TOKEN` | yes | The API token of that account. It never appears in a log, an error or a tool result. |
| `JIRA_PROJECT_KEY` | yes | The key of the project to report on, for example `EXAMPLE`. |
| `JIRA_STALE_DAYS` | no | Days without an update that make a blocker stale. Defaults to 14. |
| `JIRA_MAX_DEPTH` | no | Levels a hierarchy may have before it is reported. Defaults to 5. |
| `JIRA_TIMEOUT_MS` | no | The request timeout in milliseconds. Defaults to 15000. |
| `JIRA_EPIC_LINK_FIELD` | no | The id of the Epic Link field, `customfield_10014` by default. The id is site-specific; a site that refuses the request is read without the field instead of failing. |

Check what is set without printing a value:

```sh
env | cut -d= -f1 | grep JIRA
```

## Running it

```sh
npm ci
npm run build
JIRA_BASE_URL=https://example.atlassian.net \
JIRA_EMAIL=reader@example.com \
JIRA_API_TOKEN=... \
JIRA_PROJECT_KEY=EXAMPLE \
node ./dist/index.js
```

The server speaks MCP over its standard input and output, so a host starts it
as a subprocess and talks to it there. `--version`, `--help` and
`--healthcheck` answer without starting the server.

## Validation

```sh
npm ci
npm run check
```

`npm run check` runs the type check, the publish build, the unit tests and the
end-to-end smoke test. The smoke test spawns the built server, speaks MCP over
its standard input and output, and drives it against a local mock Jira on
loopback. No test reaches a real Jira and no test needs a credential.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
