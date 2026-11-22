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
import { issuesPointingAt } from "./rules.js";
import type { Finding, Issue } from "../jira/types.js";

/** Whether an issue is closed: its status is in the finished category. */
function isClosed(issue: Issue): boolean {
  return issue.statusCategory === "done";
}

/**
 * Whether an issue is known to be unfinished.
 *
 * An issue is finished when it carries a resolution or when its status is in
 * the category Jira groups the finished statuses in. A site that reports no
 * status category leaves that unknown, and an issue that is unknown is not
 * reported as unfinished.
 */
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
 * Find the issues where the workflow and the issue disagree.
 *
 * Three problems are reported:
 *
 * - an issue that is closed without a resolution, so the resolution reports
 *   of the project do not count it;
 * - an issue that carries a resolution while its status is still an open one,
 *   so the two say different things about the work;
 * - a closed issue with a child that is still open, so work that is still to
 *   be done hides under a parent or an epic that says it is finished.
 *
 * Both relations are followed: the parent of a sub-task and the epic of a
 * task. A closed epic with an open task under it is the same problem as a
 * closed parent with an open sub-task.
 */
export function findWorkflowProblems(issues: readonly Issue[]): Finding[] {
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  const findings: Finding[] = [];

  for (const issue of issues) {
    if (isClosed(issue) && issue.resolution === undefined) {
      findings.push({
        category: "workflow-problem",
        issueKey: issue.key,
        summary: issue.summary,
        detail: `The issue is in ${issue.status} but has no resolution, so the resolution reports of the project do not count it.`,
        severity: "medium",
        relatedKeys: [],
      });
    }

    if (
      issue.resolution !== undefined &&
      issue.statusCategory !== undefined &&
      !isClosed(issue)
    ) {
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

  // The rule about a closed issue with open work under it needs nothing but
  // the two issues it names, so it does not depend on the listing covering
  // the project: both issues were read, and both say what they say.
  const children = issuesPointingAt(issues);
  for (const parent of issues) {
    if (!isClosed(parent)) {
      continue;
    }
    for (const childKey of children.get(parent.key) ?? []) {
      const child = byKey.get(childKey);
      if (child === undefined || !isUnfinished(child)) {
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
  }

  return findings;
}
