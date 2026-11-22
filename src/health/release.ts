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
 * - a version that was released while issues in it were still open, so the
 *   release notes and the burndown do not describe what shipped;
 * - a version that was released without a release date, so nothing says when
 *   it shipped;
 * - a version that holds no issues at all, so it will ship nothing.
 */
export function findReleaseProblems(
  issues: readonly Issue[],
  versions: readonly ProjectVersion[],
): Finding[] {
  const findings: Finding[] = [];

  for (const version of versions) {
    const inVersion = issues.filter((issue) =>
      issue.fixVersions.includes(version.name),
    );
    const open = inVersion.filter(isUnfinished);

    if (version.released && open.length > 0) {
      findings.push({
        category: "release-problem",
        issueKey: version.name,
        summary: `The release ${version.name} was released while ${open.length} issue(s) in it were still open.`,
        detail: `The release ${version.name} was released while ${open.length} issue(s) in it were still open: ${open.map((issue) => issue.key).join(", ")}.`,
        severity: "high",
        relatedKeys: open.map((issue) => issue.key),
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
        summary: `The release ${version.name} holds no issues.`,
        detail: `The release ${version.name} holds no issues, so it will ship nothing.`,
        severity: "low",
        relatedKeys: [],
      });
    }
  }

  return findings;
}
