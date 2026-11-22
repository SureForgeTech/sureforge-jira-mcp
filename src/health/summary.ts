/**
 * The health summary.
 *
 * The summary is the aggregate view: how many findings there are, which
 * category they belong to, how bad they are, and which of them to look at
 * first. It is what a caller reads when it wants one answer rather than the
 * lists of every tool.
 */
import type { Finding, FindingCategory } from "../jira/types.js";

/** The aggregate health of a project. */
export interface HealthSummary {
  /** `healthy` when there is nothing to report. */
  readonly status: "healthy" | "needs-attention";
  /** The number of findings in total. */
  readonly total: number;
  /** The number of findings per category. */
  readonly byCategory: Readonly<Record<FindingCategory, number>>;
  /** The number of findings per severity. */
  readonly bySeverity: Readonly<{ high: number; medium: number; low: number }>;
  /** The findings to look at first, worst first. */
  readonly topFindings: readonly Finding[];
}

/** The severity order, worst first. */
const SEVERITY_ORDER: Record<Finding["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** Every category, so the summary always reports the same shape. */
const CATEGORIES: readonly FindingCategory[] = [
  "orphaned-issue",
  "missing-release-version",
  "stale-blocker",
  "broken-hierarchy",
  "issue-hygiene",
  "workflow-problem",
  "release-problem",
];

/**
 * Sort findings worst first.
 *
 * The order is total and stable: severity, then category, then issue key, so
 * the same set of findings always produces the same summary.
 */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const bySeverity =
      SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byCategory = left.category.localeCompare(right.category);
    if (byCategory !== 0) {
      return byCategory;
    }
    return left.issueKey.localeCompare(right.issueKey);
  });
}

/**
 * Summarize a set of findings.
 *
 * `limit` caps the number of findings in `topFindings`; the counts always
 * cover every finding.
 */
export function summarizeHealth(
  findings: readonly Finding[],
  options?: { limit?: number },
): HealthSummary {
  const limit = options?.limit ?? 10;

  const byCategory: Record<FindingCategory, number> = {
    "orphaned-issue": 0,
    "missing-release-version": 0,
    "stale-blocker": 0,
    "broken-hierarchy": 0,
    "issue-hygiene": 0,
    "workflow-problem": 0,
    "release-problem": 0,
  };
  const bySeverity = { high: 0, medium: 0, low: 0 };

  for (const finding of findings) {
    byCategory[finding.category] += 1;
    bySeverity[finding.severity] += 1;
  }

  const ordered = sortFindings(findings);

  return {
    status: findings.length === 0 ? "healthy" : "needs-attention",
    total: findings.length,
    byCategory,
    bySeverity,
    topFindings: ordered.slice(0, Math.max(limit, 0)),
  };
}

/** The categories the summary counts. */
export const SUMMARY_CATEGORIES = CATEGORIES;
