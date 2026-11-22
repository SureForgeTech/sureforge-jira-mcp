import assert from "node:assert/strict";
import { test } from "node:test";
import { findWorkflowProblems } from "./workflow.js";
import { makeIssue } from "../testing/fixtures.js";

test("an issue that is closed without a resolution is reported", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "Done",
      statusCategory: "done",
    }),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "workflow-problem");
  assert.equal(findings[0].issueKey, "EX-1");
  assert.match(findings[0].detail, /no resolution/);
});

test("a closed issue with a resolution is not reported", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "Done",
      statusCategory: "done",
      resolution: "Done",
    }),
  ]);
  assert.deepEqual(findings, []);
});

test("an issue that is resolved but still open is reported", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "In Progress",
      statusCategory: "indeterminate",
      resolution: "Fixed",
    }),
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /resolved as Fixed/);
});

test("an open issue without a resolution is not reported", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "In Progress",
      statusCategory: "indeterminate",
    }),
  ]);
  assert.deepEqual(findings, []);
});

test("a closed parent with an open child is reported as high severity", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "Done",
      statusCategory: "done",
      resolution: "Done",
    }),
    makeIssue({
      key: "EX-2",
      parentKey: "EX-1",
      status: "To Do",
      statusCategory: "new",
    }),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].issueKey, "EX-1");
  assert.equal(findings[0].severity, "high");
  assert.deepEqual([...findings[0].relatedKeys], ["EX-2"]);
});

test("a closed parent whose children are all finished is not reported", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "Done",
      statusCategory: "done",
      resolution: "Done",
    }),
    makeIssue({
      key: "EX-2",
      parentKey: "EX-1",
      status: "Done",
      statusCategory: "done",
      resolution: "Done",
    }),
  ]);
  assert.deepEqual(findings, []);
});

test("an open parent with an open child is not reported", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "In Progress",
      statusCategory: "indeterminate",
    }),
    makeIssue({
      key: "EX-2",
      parentKey: "EX-1",
      status: "To Do",
      statusCategory: "new",
    }),
  ]);
  assert.deepEqual(findings, []);
});

test("the rule about a closed parent does not fire on an incomplete listing", () => {
  const findings = findWorkflowProblems(
    [
      makeIssue({
        key: "EX-1",
        status: "Done",
        statusCategory: "done",
        resolution: "Done",
      }),
      makeIssue({
        key: "EX-2",
        parentKey: "EX-1",
        status: "To Do",
        statusCategory: "new",
      }),
    ],
    { listingComplete: false },
  );
  assert.deepEqual(
    findings,
    [],
    "a parent that was not read cannot be checked",
  );
});

test("a closed parent whose child was not read is not reported", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "Done",
      statusCategory: "done",
      resolution: "Done",
    }),
  ]);
  assert.deepEqual(findings, []);
});

test("a closed issue with an empty resolution name is still reported", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "Closed",
      statusCategory: "done",
      resolution: undefined,
    }),
  ]);
  assert.equal(findings.length, 1);
});

test("every finding names the issue it is about", () => {
  const findings = findWorkflowProblems([
    makeIssue({ key: "EX-1", status: "Done", statusCategory: "done" }),
  ]);
  assert.ok(findings.length > 0);
  for (const finding of findings) {
    assert.equal(finding.category, "workflow-problem");
    assert.equal(finding.issueKey, "EX-1");
  }
});
