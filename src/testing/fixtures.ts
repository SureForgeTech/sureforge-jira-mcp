/**
 * Fixtures for the tests.
 *
 * Every value here is invented: the keys, the versions and the dates belong
 * to no real Jira instance, and no fixture carries a real account.
 */
import type { Issue, ProjectVersion } from "../jira/types.js";

/** The reference time the tests measure staleness against. */
export const NOW = new Date("2026-03-01T00:00:00.000Z");

/** Build an issue, filling in the fields a test does not care about. */
export function makeIssue(
  overrides: Partial<Issue> & { key: string },
): Issue {
  return {
    id: overrides.key,
    summary: `Summary for ${overrides.key}`,
    status: "To Do",
    issueType: "Task",
    fixVersions: [],
    labels: [],
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    projectKey: "EXAMPLE",
    issueLinks: [],
    descriptionPresent: true,
    statusCategory: "new" as const,
    assignee: "A Person",
    ...overrides,
  };
}

/** The release versions of the example project. */
export const EXAMPLE_VERSIONS: ProjectVersion[] = [
  {
    name: "1.0.0",
    released: true,
    releaseDate: "2026-02-01",
    archived: false,
  },
  { name: "1.1.0", released: false, archived: false },
  { name: "2.0.0", released: false, archived: false },
];
