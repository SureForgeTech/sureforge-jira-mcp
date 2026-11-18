# Changelog

All notable changes to this project are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses semantic versioning.

## Unreleased

### Added

- Project scaffold: the TypeScript build, the declared `npm run check`
  validation command and the server entry point.
- The MCP server speaks over its standard input and output and publishes five
  read-only tools: `jira_find_orphaned_issues`,
  `jira_find_missing_release_versions`, `jira_find_stale_blockers`,
  `jira_find_broken_hierarchies` and `jira_health_summary`.
- The Jira REST client reads a project and its release versions, falls back to
  the earlier search endpoint when a site does not know the current one, and
  never carries a credential into a message.
- The configuration comes from the environment only: the site, the account,
  the API token, the project and the two thresholds. The token is redacted
  from every message.
