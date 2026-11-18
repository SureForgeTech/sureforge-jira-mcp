import assert from "node:assert/strict";
import { test } from "node:test";
import { sortFindings, summarizeHealth } from "./summary.js";
import type { Finding } from "../jira/types.js";

function finding(overrides: Partial<Finding> & { issueKey: string }): Finding {
  return {
    category: "orphaned-issue",
    summary: `Summary for ${overrides.issueKey}`,
    detail: "A detail",
    severity: "medium",
    relatedKeys: [],
    ...overrides,
  };
}

test("an empty set of findings is healthy", () => {
  const summary = summarizeHealth([]);
  assert.equal(summary.status, "healthy");
  assert.equal(summary.total, 0);
  assert.deepEqual(summary.topFindings, []);
});

test("a set of findings needs attention", () => {
  const summary = summarizeHealth([finding({ issueKey: "EX-1" })]);
  assert.equal(summary.status, "needs-attention");
  assert.equal(summary.total, 1);
});

test("the summary counts every category, even the empty ones", () => {
  const summary = summarizeHealth([
    finding({ issueKey: "EX-1" }),
    finding({ issueKey: "EX-2", category: "stale-blocker" }),
  ]);
  assert.deepEqual(summary.byCategory, {
    "orphaned-issue": 1,
    "missing-release-version": 0,
    "stale-blocker": 1,
    "broken-hierarchy": 0,
  });
});

test("the summary counts the severities", () => {
  const summary = summarizeHealth([
    finding({ issueKey: "EX-1", severity: "high" }),
    finding({ issueKey: "EX-2", severity: "low" }),
    finding({ issueKey: "EX-3", severity: "low" }),
  ]);
  assert.deepEqual(summary.bySeverity, { high: 1, medium: 0, low: 2 });
});

test("the findings are ordered worst first", () => {
  const summary = summarizeHealth([
    finding({ issueKey: "EX-1", severity: "low" }),
    finding({ issueKey: "EX-2", severity: "high" }),
    finding({ issueKey: "EX-3", severity: "medium" }),
  ]);
  assert.deepEqual(
    summary.topFindings.map((entry) => entry.issueKey),
    ["EX-2", "EX-3", "EX-1"],
  );
});

test("the ordering is stable for findings of the same severity", () => {
  const summary = summarizeHealth([
    finding({ issueKey: "EX-2" }),
    finding({ issueKey: "EX-1" }),
  ]);
  assert.deepEqual(
    summary.topFindings.map((entry) => entry.issueKey),
    ["EX-1", "EX-2"],
  );
});

test("the summary caps the findings it lists but not the counts", () => {
  const summary = summarizeHealth(
    [
      finding({ issueKey: "EX-1" }),
      finding({ issueKey: "EX-2" }),
      finding({ issueKey: "EX-3" }),
    ],
    { limit: 2 },
  );
  assert.equal(summary.total, 3);
  assert.equal(summary.topFindings.length, 2);
});

test("a negative limit lists no findings at all", () => {
  const summary = summarizeHealth([finding({ issueKey: "EX-1" })], {
    limit: -1,
  });
  assert.equal(summary.total, 1);
  assert.deepEqual(summary.topFindings, []);
});

test("sorting does not change the array it is given", () => {
  const findings = [
    finding({ issueKey: "EX-2", severity: "low" }),
    finding({ issueKey: "EX-1", severity: "high" }),
  ];
  const sorted = sortFindings(findings);
  assert.equal(sorted[0].issueKey, "EX-1");
  assert.equal(findings[0].issueKey, "EX-2");
});
