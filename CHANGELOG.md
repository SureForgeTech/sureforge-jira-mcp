# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses semantic versioning.

## Unreleased

### Added

- Project scaffold: the TypeScript build, the declared `npm run check`
  validation command and the server entry point.
- The MCP server speaks over its standard input and output and publishes seven
  read-only tools: `jira_find_orphaned_issues`,
  `jira_find_missing_release_versions`, `jira_find_stale_blockers`,
  `jira_find_broken_hierarchies`, `jira_health_summary`,
  `jira_check_installation` and `jira_find_issue_hygiene_problems`.
- The Jira REST client reads a project and its release versions, falls back to
  the earlier search endpoint when a site does not know the current one, and
  never carries a credential into a message.
- The client falls back to the REST API version 2 paths when a site does not
  know the current version, so Jira Data Center and Jira Server, which
  document version 2, are read as well. A site that knows none of the
  search paths now answers the error of the last path tried, the version 2
  one.
- The configuration comes from the environment only: the site, the account,
  the API token, the project and the three thresholds. The token is redacted
  from every message.
- `JIRA_EPIC_LINK_FIELD` names the Epic Link field, `customfield_10014` by
  default. A site that refuses the field is read without it, and the result
  says that the epic relation is unknown.

- `jira_find_issue_hygiene_problems` reports the issues that are not kept well
  enough to be worked on: no summary, no description, work in progress without
  an assignee, no priority, a due date that has passed while the issue is still
  open, and work in progress that has not been updated for the threshold.
- The issue carries its assignee, the presence of a description and the status
  category, so a rule can tell work in progress from work that has not started
  without relying on the names of the statuses.
- `jira_check_installation` reports the health of the installation: the
  deployment type and version of the instance, the health checks the instance
  reports about itself, whether the project can be read, the support status of
  the deployment, and the guidance that holds for that deployment.

### Changed

- A listing that may be missing issues reports itself as such: the findings
  that depend on the absence of an issue are hedged and lower in severity,
  and the result carries `truncated`, `issuesDropped` and `epicLinkKnown`.
  The findings that would state that an issue has no epic are hedged as well
  when the site refused the Epic Link field, or when the field holds a value
  that cannot be an epic relation.
