/**
 * The release health rules.
 *
 * The other rules look at the issues and at what they point at. These look at
 * the releases themselves, which is where a project goes wrong quietly: a
 * version that was released while work was still open, a version that was
 * released without a date, and a version that holds nothing at all.
 *
 * The rules are pure functions over normalized issues and versions: no clock,
 * no environment and no network.
 */
import type { Finding, Issue, ProjectVersion } from "../jira/types.js";

/** The settings the release rules take. */
export interface ReleaseOptions {
  /**
   * Whether the listing covers the whole project.
   *
   * A version that holds no issue in the listing may hold issues outside it,
   * so the rule that says a version holds nothing is hedged when the listing
   * is incomplete.
   */
  readonly listingComplete?: boolean;
}

/** The number of issue keys one finding names. */
const MAX_NAMED_KEYS = 10;

/** Whether an issue is known to be unfinished. */
function isUnfinished(issue: Issue): boolean {
  if (issue.resolution !== undefined) {
    return false;
  }
  if (issue.statusCategory === undefined) {
    return false;
  }
  return issue.statusCategory !== "done";
}

/**
 * Find the releases that do not say what they should say.
 *
 * Three problems are reported:
 *
 * - a version that was released and still holds open issues, so the release
 *   notes and the burndown do not describe what shipped;
 * - a version that was released without a release date, so nothing says when
 *   it shipped;
 * - a version that holds no issues at all, so it will ship nothing.
 */
export function findReleaseProblems(
  issues: readonly Issue[],
  versions: readonly ProjectVersion[],
  options: ReleaseOptions = {},
): Finding[] {
  const listingComplete = options.listingComplete ?? true;
  const findings: Finding[] = [];

  for (const version of versions) {
    const inVersion = issues.filter((issue) =>
      issue.fixVersions.includes(version.name),
    );
    const open = inVersion.filter(isUnfinished);

    if (version.released && open.length > 0) {
      const keys = open.map((issue) => issue.key);
      const named = keys.slice(0, MAX_NAMED_KEYS);
      const rest = keys.length - named.length;
      findings.push({
        category: "release-problem",
        issueKey: version.name,
        summary: `The release ${version.name} still holds ${keys.length} open issue(s).`,
        detail: `The release ${version.name} still holds ${keys.length} open issue(s): ${named.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}.`,
        severity: "high",
        relatedKeys: keys,
      });
    }

    if (version.released && version.releaseDate === undefined) {
      findings.push({
        category: "release-problem",
        issueKey: version.name,
        summary: `The release ${version.name} was released without a release date.`,
        detail: `The release ${version.name} was released without a release date, so nothing says when it shipped.`,
        severity: "medium",
        relatedKeys: [],
      });
    }

    if (inVersion.length === 0 && !version.archived) {
      findings.push({
        category: "release-problem",
        issueKey: version.name,
        summary: listingComplete
          ? `The release ${version.name} holds no issues.`
          : `No issue of the listing names the release ${version.name}.`,
        detail: listingComplete
          ? `The release ${version.name} holds no issues, so it will ship nothing.`
          : `No issue of the listing names the release ${version.name}, and the listing does not cover the whole project.`,
        severity: "low",
        relatedKeys: [],
      });
    }
  }

  return findings;
}
