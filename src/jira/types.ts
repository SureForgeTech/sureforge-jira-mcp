/**
 * The normalized Jira domain model.
 *
 * The health rules work on these types, never on the REST payloads: the
 * client and the normalizer own every difference between the Jira API and
 * the shapes the rules reason about.
 */

/** One link between two issues. */
export interface IssueLink {
  /** The link type as Jira names it, for example `Blocks`. */
  readonly type: string;
  /**
   * Which way the link points. `outward` means this issue is the source of
   * the link, `inward` means this issue is the target.
   */
  readonly direction: "outward" | "inward";
  /** The key of the issue on the other end of the link. */
  readonly targetKey: string;
}

/** A Jira issue, normalized. */
export interface Issue {
  /** The issue key, for example `EXAMPLE-1`. */
  readonly key: string;
  /** The opaque Jira issue id. */
  readonly id: string;
  /** The issue summary. */
  readonly summary: string;
  /** The status name, for example `In Progress`. */
  readonly status: string;
  /** The issue type name, for example `Task` or `Sub-task`. */
  readonly issueType: string;
  /** The resolution name, or `undefined` while the issue is unresolved. */
  readonly resolution?: string;
  /** The key of the parent issue, when the issue has one. */
  readonly parentKey?: string;
  /** The key of the epic this issue belongs to, when it has one. */
  readonly epicKey?: string;
  /** The names of the versions this issue ships in. */
  readonly fixVersions: readonly string[];
  /** The labels on the issue. */
  readonly labels: readonly string[];
  /** The creation timestamp, as an ISO 8601 string. */
  readonly created: string;
  /** The last update timestamp, as an ISO 8601 string. */
  readonly updated: string;
  /** The key of the project the issue belongs to. */
  readonly projectKey: string;
  /** The links between this issue and other issues. */
  readonly issueLinks: readonly IssueLink[];
  /** The priority name, when the issue has one. */
  readonly priority?: string;
  /** The due date, as an ISO 8601 date, when the issue has one. */
  readonly dueDate?: string;
}

/** A release version of a project. */
export interface ProjectVersion {
  /** The version name, for example `1.0.0`. */
  readonly name: string;
  /** Whether the version is released. */
  readonly released: boolean;
  /** The release date, as an ISO 8601 date, when the version has one. */
  readonly releaseDate?: string;
  /** Whether the version is archived. */
  readonly archived: boolean;
}

/** The categories of finding the health rules produce. */
export type FindingCategory =
  | "orphaned-issue"
  | "missing-release-version"
  | "stale-blocker"
  | "broken-hierarchy";

/** One health finding. */
export interface Finding {
  /** The category the finding belongs to. */
  readonly category: FindingCategory;
  /** The issue the finding is about. */
  readonly issueKey: string;
  /** The issue summary, so a reader does not need to look the issue up. */
  readonly summary: string;
  /** A one-line description of what is wrong. */
  readonly detail: string;
  /**
   * How bad the finding is. `high` findings block a release or break a
   * hierarchy, `medium` findings hide work, `low` findings are worth
   * tidying.
   */
  readonly severity: "high" | "medium" | "low";
  /** The issue keys the finding refers to, for example the blocking target. */
  readonly relatedKeys: readonly string[];
}
