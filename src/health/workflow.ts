/**
 * The workflow consistency rules.
 *
 * Atlassian's guidance on workflows says that an issue has to agree with
 * itself: a finished issue carries a resolution, a resolution means the issue
 * is finished, and a parent that is closed has no open work under it. These
 * are the three disagreements a project accumulates, and every report built
 * on the issue fields is wrong while they exist.
 *
 * The rules are pure functions over normalized issues: no clock, no
 * environment and no network.
 */
import type { Finding, Issue } from "../jira/types.js";

/** The settings the workflow rules take. */
export interface WorkflowOptions {
  /**
   * Whether the listing covers the whole project.
   *
   * A parent that is not in the listing may still exist, so the rule about
   * a child of a closed parent cannot fire without it.
   */
  readonly listingComplete?: boolean;
}

/** Whether an issue is finished. */
function isFinished(issue: Issue): boolean {
  return issue.resolution !== undefined || issue.statusCategory === "done";
}

/** Whether an issue is closed: its status is in the finished category. */
function isClosed(issue: Issue): boolean {
  return issue.statusCategory === "done";
}

/**
 * Find the issues where the workflow and the issue disagree.
 *
 * Three problems are reported:
 *
 * - an issue that is closed without a resolution, so the resolution reports
 *   of the project do not count it;
 * - an issue that carries a resolution while its status is still an open one,
 *   so the two say different things about the work;
 * - a closed parent with a child that is still open, so work that is still to
 *   be done hides under a parent that says it is finished.
 */
export function findWorkflowProblems(
  issues: readonly Issue[],
  options: WorkflowOptions = {},
): Finding[] {
  const listingComplete = options.listingComplete ?? true;
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  const findings: Finding[] = [];

  for (const issue of issues) {
    if (isClosed(issue) && issue.resolution === undefined) {
      findings.push({
        category: "workflow-problem",
        issueKey: issue.key,
        summary: issue.summary,
        detail: `The issue is in ${issue.status} but has no resolution, so it is not counted as finished.`,
        severity: "medium",
        relatedKeys: [],
      });
    }

    if (issue.resolution !== undefined && !isClosed(issue)) {
      findings.push({
        category: "workflow-problem",
        issueKey: issue.key,
        summary: issue.summary,
        detail: `The issue is resolved as ${issue.resolution} but its status is ${issue.status}.`,
        severity: "medium",
        relatedKeys: [],
      });
    }
  }

  if (!listingComplete) {
    // A parent that was not read cannot be checked, so the rule about a
    // closed parent with open work does not fire.
    return findings;
  }

  for (const child of issues) {
    if (child.parentKey === undefined || isFinished(child)) {
      continue;
    }
    const parent = byKey.get(child.parentKey);
    if (parent === undefined || !isClosed(parent)) {
      continue;
    }
    findings.push({
      category: "workflow-problem",
      issueKey: parent.key,
      summary: parent.summary,
      detail: `The issue is in ${parent.status} while ${child.key} under it is still open.`,
      severity: "high",
      relatedKeys: [child.key],
    });
  }

  return findings;
}
