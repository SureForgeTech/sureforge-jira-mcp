import assert from "node:assert/strict";
import { test } from "node:test";
import { findHygieneProblems, type HygieneOptions } from "./hygiene.js";
import { makeIssue, NOW } from "../testing/fixtures.js";

const options: HygieneOptions = {
  staleInProgressDays: 30,
  now: NOW,
};

test("an issue without a summary is reported", () => {
  const findings = findHygieneProblems(
    [makeIssue({ key: "EX-1", summary: "", priority: "Medium" })],
    options,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "issue-hygiene");
  assert.match(findings[0].detail, /no summary/);
});

test("an issue with a summary is not reported for it", () => {
  const findings = findHygieneProblems([makeIssue({ key: "EX-1" })], options);
  assert.deepEqual(
    findings.filter((finding) => finding.detail.includes("no summary")),
    [],
  );
});

test("an issue without a description is reported", () => {
  const findings = findHygieneProblems(
    [makeIssue({ key: "EX-1", descriptionPresent: false, priority: "Medium" })],
    options,
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /no description/);
});

test("a sub-task without a description is not reported", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        issueType: "Sub-task",
        descriptionPresent: false,
        priority: "Medium",
      }),
    ],
    options,
  );
  assert.deepEqual(
    findings.filter((finding) => finding.detail.includes("no description")),
    [],
  );
});

test("work in progress without an assignee is reported as high severity", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        status: "In Progress",
        statusCategory: "indeterminate",
        assignee: undefined,
      }),
    ],
    options,
  );
  const finding = findings.find((entry) =>
    entry.detail.includes("no assignee"),
  );
  assert.ok(finding);
  assert.equal(finding.severity, "high");
});

test("a resolved issue in an open status is not reported as work without an owner", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        status: "In Progress",
        statusCategory: "indeterminate",
        assignee: undefined,
        resolution: "Done",
      }),
    ],
    options,
  );
  assert.deepEqual(
    findings.filter((entry) => entry.detail.includes("no assignee")),
    [],
  );
});

test("an issue whose status category is unknown is not read as work in progress", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        status: "In Progress",
        statusCategory: undefined,
        assignee: undefined,
      }),
    ],
    options,
  );
  assert.deepEqual(
    findings.filter(
      (entry) =>
        entry.detail.includes("no assignee") ||
        entry.detail.includes("without an update"),
    ),
    [],
  );
});

test("work in progress with an assignee is not reported for it", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        status: "In Progress",
        statusCategory: "indeterminate",
        assignee: "A Person",
      }),
    ],
    options,
  );
  assert.deepEqual(
    findings.filter((entry) => entry.detail.includes("no assignee")),
    [],
  );
});

test("an issue without a priority is reported as low severity", () => {
  const findings = findHygieneProblems([makeIssue({ key: "EX-1" })], options);
  const finding = findings.find((entry) => entry.detail.includes("no priority"));
  assert.ok(finding);
  assert.equal(finding.severity, "low");
});

test("an issue with a priority is not reported for it", () => {
  const findings = findHygieneProblems(
    [makeIssue({ key: "EX-1", priority: "High" })],
    options,
  );
  assert.deepEqual(
    findings.filter((entry) => entry.detail.includes("no priority")),
    [],
  );
});

test("an open issue whose due date has passed is reported", () => {
  const findings = findHygieneProblems(
    [makeIssue({ key: "EX-1", dueDate: "2026-02-01" })],
    options,
  );
  const finding = findings.find((entry) => entry.detail.includes("still open"));
  assert.ok(finding);
  assert.equal(finding.severity, "high");
});

test("an issue that is due today is not overdue yet", () => {
  const findings = findHygieneProblems(
    [makeIssue({ key: "EX-1", dueDate: "2026-03-01" })],
    options,
  );
  assert.deepEqual(
    findings.filter((entry) => entry.detail.includes("still open")),
    [],
  );
});

test("a resolved issue whose due date has passed is not reported", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        dueDate: "2026-02-01",
        resolution: "Done",
      }),
    ],
    options,
  );
  assert.deepEqual(
    findings.filter((entry) => entry.detail.includes("still open")),
    [],
  );
});

test("work in progress that has not moved for the threshold is reported", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        status: "In Progress",
        statusCategory: "indeterminate",
        updated: "2026-01-01T00:00:00.000Z",
      }),
    ],
    options,
  );
  const finding = findings.find((entry) => entry.detail.includes("without an update"));
  assert.ok(finding);
  assert.match(finding.detail, /59 days/);
});

test("work in progress that moved recently is not reported", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        status: "In Progress",
        statusCategory: "indeterminate",
        updated: "2026-02-28T00:00:00.000Z",
      }),
    ],
    options,
  );
  assert.deepEqual(
    findings.filter((entry) => entry.detail.includes("without an update")),
    [],
  );
});

test("an issue that is not in progress is never stale", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        status: "To Do",
        statusCategory: "new",
        updated: "2026-01-01T00:00:00.000Z",
      }),
    ],
    options,
  );
  assert.deepEqual(
    findings.filter((entry) => entry.detail.includes("without an update")),
    [],
  );
});

test("a threshold of its own is honoured", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        status: "In Progress",
        statusCategory: "indeterminate",
        updated: "2026-02-20T00:00:00.000Z",
      }),
    ],
    { ...options, staleInProgressDays: 5 },
  );
  assert.ok(
    findings.some((entry) => entry.detail.includes("without an update")),
  );
});

test("a due date that cannot be read is not overdue", () => {
  const findings = findHygieneProblems(
    [makeIssue({ key: "EX-1", dueDate: "not a date" })],
    options,
  );
  assert.deepEqual(
    findings.filter((entry) => entry.detail.includes("still open")),
    [],
  );
});

test("a well kept issue is reported for nothing", () => {
  const findings = findHygieneProblems(
    [
      makeIssue({
        key: "EX-1",
        summary: "A well kept issue",
        descriptionPresent: true,
        priority: "Medium",
        assignee: "A Person",
        statusCategory: "done",
        resolution: "Done",
      }),
    ],
    options,
  );
  assert.deepEqual(findings, []);
});

test("every finding names the issue it is about", () => {
  const findings = findHygieneProblems(
    [makeIssue({ key: "EX-1", summary: "" })],
    options,
  );
  assert.ok(findings.length > 0);
  for (const finding of findings) {
    assert.equal(finding.issueKey, "EX-1");
    assert.equal(finding.category, "issue-hygiene");
  }
});
