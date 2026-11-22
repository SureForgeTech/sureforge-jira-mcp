# sureforge-jira-mcp

MCP server for Jira health: finds orphaned issues, missing release versions, stale blockers, broken hierarchies, the issues that are not kept well enough to be worked on and the issues where the workflow and the issue disagree, and reports the health of the installation.

The server only reads. It never changes an issue, and it never writes to Jira.

## The tools

| Tool | What it finds |
| --- | --- |
| `jira_find_orphaned_issues` | Open issues that stand on their own: no parent, no epic, no link to another issue, and nothing pointing at them. |
| `jira_find_missing_release_versions` | Issues whose release version is missing or wrong: an issue names a version the project does not have, or an issue ships in a release while its parent carries no version. |
| `jira_find_stale_blockers` | Open issues that block other issues and have not been updated for the staleness threshold or longer. A blocker of work that already ships is reported as high severity. |
| `jira_find_broken_hierarchies` | Broken issue hierarchies: a parent or epic that does not exist, a parent chain that loops, and a hierarchy deeper than the depth limit. |
| `jira_health_summary` | The aggregate view: the number of findings per category and severity - the hygiene findings included - the findings to look at first, and a status of `healthy` or `needs-attention`. |
| `jira_check_installation` | The health of the installation: the deployment type and version of the instance, the health checks the instance reports about itself, whether the project can be read, and the guidance that holds for that deployment. |
| `jira_find_issue_hygiene_problems` | The issues that are not kept well enough to be worked on: no summary, no description, work in progress without an assignee, no priority, a due date that has passed while the issue is still open, and work in progress that has not been updated for the staleness threshold. |
| `jira_find_workflow_problems` | The issues where the workflow and the issue disagree: an issue that is closed without a resolution, an issue that is resolved while its status is still open, and a closed parent whose sub-task is still open. |

Every tool that reports findings takes an optional `projectKey`, an optional
`limit`, and the thresholds that apply to it (`staleDays`, `maxDepth`,
`staleInProgressDays`). The findings are ordered worst first.
`jira_check_installation` reports on the installation rather than on findings,
so it takes only `projectKey`.

Every tool that reads issues carries `issuesExamined`, the number of issues
it looked at. A listing reads at most 2000 issues per project. When the listing may be
missing issues the result carries `truncated: true`, and `issuesDropped`
names how many issues the listing left out - the ones the site returned
without a key, and the ones the issue cap cut off. A parent or epic that
is not in an incomplete listing is reported as "not found in the listing"
rather than as a broken hierarchy, and an issue that nothing in an incomplete
listing points at is reported as an orphan with a lower severity and a hedged
detail, because a partial listing cannot prove that an issue does not exist.
The same holds for the epic relation: when a site refuses the Epic Link field,
or when the field holds a value that cannot be an epic relation - free text, a
number, a list - the result carries `epicLinkKnown: false`, and the findings
that would state that an issue has no epic are hedged and lower in severity
instead.

## Issue hygiene

`jira_find_issue_hygiene_problems` reports the issues that are not kept well
enough to be worked on, the defects Atlassian's own Jira guidance calls out:

- **no summary** - Jira allows it, but no report can name the issue;
- **no description** - there is nothing for anyone to act on. A sub-task does
  not need one;
- **work in progress without an assignee** - nobody owns the work;
- **no priority** - the issue is never scheduled;
- **a due date that has passed** while the issue is still open - a commitment
  that was missed. An issue whose status is in the category Jira groups the
  finished statuses in counts as finished, even when its resolution field is
  empty, and an issue whose status category the site does not report is not
  reported as open at all;
- **work in progress that has not been updated** for the staleness threshold
  (`JIRA_STALE_IN_PROGRESS_DAYS`, 30 days by default).

Whether work is in progress is decided by the status *category* Jira groups
the status in (`new`, `indeterminate`, `done`), not by the name of the status,
because the names differ from site to site. Only `indeterminate` - the
category of the statuses like `In Progress` - counts as work in progress: a
`To Do` issue without an assignee is not reported, because nobody is working
on it yet. A site that reports no category
at all leaves that unknown, and an unknown category is not work in progress.
A due date without a time is read as the end of that day in UTC.

The rules report the work that is not finished: an issue that carries a
resolution, or whose status is in the category Jira groups the finished
statuses in, is left alone. An issue that is assigned to an account the site
does not name - an anonymized profile, a deleted account - counts as
assigned, because the account is there.

## Workflow consistency

`jira_find_workflow_problems` reports the three ways an issue can disagree
with itself, which is what Atlassian's guidance on workflows asks for:

- **closed without a resolution** - the status says the work is finished and
  the resolution field is empty, so the resolution reports of the project do
  not count it;
- **resolved but still open** - the issue carries a resolution while its
  status is still an open one, so the two say different things about the
  work;
- **a closed parent with an open sub-task** - work that is still to be done
  hides under a parent that says it is finished. The parent relation is the
  one that is followed; a task under a closed epic is a different relation,
  and the hierarchy rules report that.

Whether a status is closed is decided by the status category, as everywhere
else in this server. A site that reports no category leaves that unknown, and
an unknown status proves nothing: a rule never reports an issue as open, as
closed or as unfinished when the site did not say. The rule about a closed
parent needs only the two issues it names, so it fires even when the listing
is incomplete.

## Deployment and installation

`jira_check_installation` reports the installation the server is talking to:

- **the deployment type and version** the instance reports for itself, with the
  build number and the title of the instance;
- **the health checks the instance reports about itself**, and the ones that did
  not pass. Jira Cloud does not report them any more - the field is deprecated
  there - so the report says `healthChecksReported: false` rather than
  pretending the instance was checked;
- **whether the configured project can be read** by the configured account;
- **the support status of the deployment** and **the guidance that holds for
  it**: on Cloud, Atlassian runs the instance and the current search endpoint
  is `/rest/api/3/search/jql`; on Data Center the organisation runs the
  instance and Atlassian documents REST API version 2 there, so the server
  reads the earlier version when an instance answers 404 for a version 3 path;
  on Jira Server, whose support Atlassian ended in February 2024, the
  instance receives no fixes from Atlassian. The support of a Data Center
  release depends on that release, so the report says `unknown` and names the
  version it read.

The report is `healthy` when the instance reports no failing health check,
the project can be read, and the instance said something about itself - a
deployment type or a version. It is `needs-attention` otherwise, because a
report without instance evidence cannot call an installation healthy. A deployment Atlassian
no longer supports is reported as `end-of-support`; that is a fact about the
deployment, not a fault in the instance, so it does not change the status.

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
| `JIRA_STALE_IN_PROGRESS_DAYS` | no | Days without an update that make work in progress stale. Defaults to 30. |
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
