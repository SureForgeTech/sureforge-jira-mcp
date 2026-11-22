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
  /**
   * Whether the issue type is a sub-task.
   *
   * Jira says so with a flag on the type, which is stable; the name of the
   * type is not.
   */
  readonly subTask: boolean;
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
  /**
   * Whether the issue is assigned to an account.
   *
   * The presence of the account is what says so: a site that names nobody -
   * an anonymized profile, a deleted account - still assigns the issue.
   */
  readonly assigned: boolean;
  /** Whether the issue carries a description with content. */
  readonly descriptionPresent: boolean;
  /**
   * The category of the status, as Jira groups the statuses.
   *
   * It is `new` for a status like `To Do`, `indeterminate` for a status like
   * `In Progress` and `done` for a status like `Done`. The names of the
   * statuses themselves differ from site to site, the categories do not.
   *
   * It is undefined when the site did not report a category: an older
   * Jira Server omits it, and a rule must not read an unknown category as
   * work in progress.
   */
  readonly statusCategory?: StatusCategory;
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

/** The issues of a project, and whether the listing covers the whole project. */
export interface IssueListing {
  /** The issues that were read. */
  readonly issues: readonly Issue[];
  /**
   * Whether the listing may be missing issues.
   *
   * It is true when the listing stopped at the issue cap or at the page cap,
   * when the site offered more but gave no way to read it, when the site
   * repeated a page, and when an issue was left out for want of a key. A
   * truncated listing does not cover the whole project, so an issue that is
   * not in it may still exist somewhere else. The findings that depend on
   * the absence of an issue are reported differently when it is truncated.
   */
  readonly truncated: boolean;
  /** The number of issues that were read. */
  readonly examined: number;
  /**
   * The number of issues the listing left out: the ones the site returned
   * that carried no key, and the ones the issue cap cut off.
   *
   * Such an issue may point at another one, so a listing that left any out
   * does not cover the whole project either.
   */
  readonly dropped: number;
  /**
   * Whether the epic relation is known.
   *
   * It is false when the site refused the Epic Link field and the listing
   * was read without it, and when the field holds a value that cannot be
   * an epic relation - free text, a number, a list. The epic relation is
   * then unknown, so a finding that says an issue has no epic cannot be
   * stated as fact.
   */
  readonly epicLinkKnown: boolean;
}

/** One health check the instance reports about itself. */
export interface InstanceHealthCheck {
  /** The name of the check, for example `Database`. */
  readonly name: string;
  /** What the check looked at, when the instance says so. */
  readonly description?: string;
  /**
   * Whether the check passed.
   *
   * It is undefined when the instance did not say, which is not the same as a
   * check that failed.
   */
  readonly passed?: boolean;
}

/** What the Jira instance reports about itself. */
export interface ServerInfo {
  /** The address the instance gives for itself. */
  readonly baseUrl?: string;
  /** The version of Jira. */
  readonly version?: string;
  /** The version numbers of Jira, for example `[9, 4, 0]`. */
  readonly versionNumbers?: readonly number[];
  /** The deployment type, for example `Cloud`, `Data Center` or `Server`. */
  readonly deploymentType?: string;
  /** The build number of the instance. */
  readonly buildNumber?: number;
  /** The title of the instance. */
  readonly serverTitle?: string;
  /** The health checks the instance reports about itself. */
  readonly healthChecks: readonly InstanceHealthCheck[];
  /**
   * Whether the instance reported health check results.
   *
   * Jira Cloud does not report them: the field is deprecated there and the
   * documented answer carries an empty list, so an instance without results
   * is not an instance that was checked.
   */
  readonly healthChecksReported: boolean;
}

/** The part of a project the health report needs. */
export interface ProjectSummary {
  /** The key of the project, for example `EXAMPLE`. */
  readonly key: string;
  /** The name of the project. */
  readonly name?: string;
  /** The type of the project, for example `software` or `service_desk`. */
  readonly projectTypeKey?: string;
  /** The issue types the project offers, by name. */
  readonly issueTypes: readonly string[];
}

/** The category Jira groups a status in. */
export type StatusCategory = "new" | "indeterminate" | "done";

/** The categories of finding the health rules produce. */
export type FindingCategory =
  | "orphaned-issue"
  | "missing-release-version"
  | "stale-blocker"
  | "broken-hierarchy"
  | "issue-hygiene"
  | "workflow-problem"
  | "release-problem";

/** One health finding. */
export interface Finding {
  /** The category the finding belongs to. */
  readonly category: FindingCategory;
  /**
   * The issue the finding is about.
   *
   * For a finding about a release it is the name of the version, because
   * that is what the finding is about.
   */
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
