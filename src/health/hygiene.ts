/**
 * The issue hygiene rules.
 *
 * These are the defects Atlassian's own Jira guidance calls out: an issue
 * nobody can search for, work without an owner, a commitment that was
 * missed, and work that has stood still for weeks. The rules are pure
 * functions over normalized issues: they read no clock, no environment and no
 * network, and the reference time is a parameter.
 */
import { daysSince } from "./rules.js";
import type { Finding, Issue } from "../jira/types.js";

/** The settings the hygiene rules take. */
export interface HygieneOptions {
  /** Days without an update that make work in progress stale. */
  readonly staleInProgressDays: number;
  /** The reference time the rules measure against. */
  readonly now: Date;
}

/** The issue types that do not need a description. */
const TYPES_WITHOUT_DESCRIPTION = new Set(["Sub-task", "Subtask", "sub-task"]);

/**
 * Whether a due date has passed.
 *
 * A due date without a time is read as the end of that day in UTC, so an
 * issue that is due today is not overdue until tomorrow.
 */
function isOverdue(dueDate: string, now: Date): boolean {
  const parsed = Date.parse(dueDate);
  if (Number.isNaN(parsed)) {
    return false;
  }
  const endOfDay = new Date(parsed);
  if (dueDate.length <= 10) {
    endOfDay.setUTCHours(23, 59, 59, 999);
  }
  return endOfDay.getTime() < now.getTime();
}

/**
 * Find the issues that are not kept well enough to be worked on.
 *
 * Six problems are reported:
 *
 * The rules that need to know whether work is in progress only fire when the
 * status category is known. A site that does not report the category leaves
 * that unknown, and an unknown category is not work in progress.
 *
 * - an issue without a summary, which no report can name;
 * - an issue without a description, which nobody can act on;
 * - work in progress without an assignee, which nobody owns;
 * - an issue without a priority, which is never scheduled;
 * - an issue whose due date has passed while it is still open;
 * - work in progress that has not been updated for the staleness threshold.
 */
export function findHygieneProblems(
  issues: readonly Issue[],
  options: HygieneOptions,
): Finding[] {
  const findings: Finding[] = [];

  for (const issue of issues) {
    if (issue.summary.trim() === "") {
      findings.push({
        category: "issue-hygiene",
        issueKey: issue.key,
        summary: issue.summary,
        detail: "The issue has no summary, so no report can name it.",
        severity: "medium",
        relatedKeys: [],
      });
    }

    if (
      !issue.descriptionPresent &&
      !TYPES_WITHOUT_DESCRIPTION.has(issue.issueType)
    ) {
      findings.push({
        category: "issue-hygiene",
        issueKey: issue.key,
        summary: issue.summary,
        detail: "The issue has no description, so there is nothing to act on.",
        severity: "medium",
        relatedKeys: [],
      });
    }

    if (
      issue.statusCategory === "indeterminate" &&
      issue.assignee === undefined &&
      issue.resolution === undefined
    ) {
      findings.push({
        category: "issue-hygiene",
        issueKey: issue.key,
        summary: issue.summary,
        detail: `The issue is in ${issue.status} and has no assignee, so nobody owns the work.`,
        severity: "high",
        relatedKeys: [],
      });
    }

    if (issue.priority === undefined) {
      findings.push({
        category: "issue-hygiene",
        issueKey: issue.key,
        summary: issue.summary,
        detail: "The issue has no priority, so it is never scheduled.",
        severity: "low",
        relatedKeys: [],
      });
    }

    if (
      issue.resolution === undefined &&
      issue.dueDate !== undefined &&
      isOverdue(issue.dueDate, options.now)
    ) {
      findings.push({
        category: "issue-hygiene",
        issueKey: issue.key,
        summary: issue.summary,
        detail: `The issue was due on ${issue.dueDate} and is still open.`,
        severity: "high",
        relatedKeys: [],
      });
    }

    if (
      issue.statusCategory === "indeterminate" &&
      issue.resolution === undefined
    ) {
      const age = daysSince(issue.updated, options.now);
      if (age !== undefined && age >= options.staleInProgressDays) {
        findings.push({
          category: "issue-hygiene",
          issueKey: issue.key,
          summary: issue.summary,
          detail: `The issue has been in ${issue.status} for ${age} days without an update.`,
          severity: "medium",
          relatedKeys: [],
        });
      }
    }
  }

  return findings;
}
