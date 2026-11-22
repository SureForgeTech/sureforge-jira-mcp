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

test("the rule about a closed issue with open work under it needs only the two issues", () => {
  // The rule needs nothing but the two issues it names, both of which were
  // read, so a listing that may be missing other issues does not silence it.
  // The tool level test covers the same behaviour with a truncated listing.
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
});

test("an issue whose status category the site does not report proves nothing", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "Done",
      statusCategory: undefined,
      resolution: "Fixed",
    }),
  ]);
  assert.deepEqual(
    findings,
    [],
    "the site did not say the status is closed",
  );
});

test("a child whose status category the site does not report is not called open", () => {
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
      statusCategory: undefined,
    }),
  ]);
  assert.deepEqual(
    findings,
    [],
    "the child may be finished; the site did not say",
  );
});

test("a closed parent with several open children is reported once per child", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "Done",
      statusCategory: "done",
      resolution: "Done",
    }),
    makeIssue({ key: "EX-2", parentKey: "EX-1", statusCategory: "new" }),
    makeIssue({ key: "EX-3", parentKey: "EX-1", statusCategory: "new" }),
  ]);
  assert.equal(findings.length, 2);
  for (const finding of findings) {
    assert.equal(finding.issueKey, "EX-1");
  }
});

test("a closed epic with an open task is reported: the epic relation counts too", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "Done",
      statusCategory: "done",
      resolution: "Done",
    }),
    makeIssue({ key: "EX-2", epicKey: "EX-1", statusCategory: "new" }),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].issueKey, "EX-1");
  assert.deepEqual([...findings[0].relatedKeys], ["EX-2"]);
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

test("a closed issue without a resolution is reported once", () => {
  const findings = findWorkflowProblems([
    makeIssue({
      key: "EX-1",
      status: "Closed",
      statusCategory: "done",
    }),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].issueKey, "EX-1");
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

test("a child that names the same issue as parent and epic is reported once", () => {
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
      epicKey: "EX-1",
      statusCategory: "new",
    }),
  ]);
  assert.equal(
    findings.length,
    1,
    "the relation is counted once, the way a link Jira reports from both ends is",
  );
});

test("a child that carries a resolution is not reported as unfinished", () => {
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
      status: "In Progress",
      statusCategory: "indeterminate",
      resolution: "Fixed",
    }),
  ]);
  assert.deepEqual(
    findings.filter((finding) => finding.issueKey === "EX-1"),
    [],
    "the child is finished, so the parent is not reported",
  );
});

test("the finding of an issue closed without a resolution says why", () => {
  const findings = findWorkflowProblems([
    makeIssue({ key: "EX-1", status: "Done", statusCategory: "done" }),
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /no resolution/);
  assert.match(
    findings[0].detail,
    /resolution reports of the project do not count it/,
  );
});
