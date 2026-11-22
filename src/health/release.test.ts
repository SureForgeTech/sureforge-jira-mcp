import assert from "node:assert/strict";
import { test } from "node:test";
import { findReleaseProblems } from "./release.js";
import type { ProjectVersion } from "../jira/types.js";
import { makeIssue } from "../testing/fixtures.js";

const VERSION: ProjectVersion = {
  name: "1.0.0",
  released: true,
  releaseDate: "2026-02-01",
  archived: false,
};

test("a released version that still holds open work is reported", () => {
  const findings = findReleaseProblems(
    [
      makeIssue({
        key: "EX-1",
        fixVersions: ["1.0.0"],
        statusCategory: "new",
      }),
    ],
    [VERSION],
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, "release-problem");
  assert.equal(findings[0].severity, "high");
  assert.deepEqual([...findings[0].relatedKeys], ["EX-1"]);
});

test("a released version whose issues are all finished is not reported", () => {
  const findings = findReleaseProblems(
    [
      makeIssue({
        key: "EX-1",
        fixVersions: ["1.0.0"],
        statusCategory: "done",
        resolution: "Done",
      }),
    ],
    [VERSION],
  );
  assert.deepEqual(findings, []);
});

test("an issue whose status the site does not report does not hold a release open", () => {
  const findings = findReleaseProblems(
    [
      makeIssue({
        key: "EX-1",
        fixVersions: ["1.0.0"],
        statusCategory: undefined,
      }),
    ],
    [VERSION],
  );
  assert.deepEqual(findings, []);
});

test("a version that is not released yet is not reported for open work", () => {
  const findings = findReleaseProblems(
    [
      makeIssue({
        key: "EX-1",
        fixVersions: ["1.1.0"],
        statusCategory: "new",
      }),
    ],
    [
      {
        name: "1.1.0",
        released: false,
        archived: false,
      },
    ],
  );
  assert.deepEqual(findings, []);
});

test("a released version without a release date is reported", () => {
  const findings = findReleaseProblems(
    [
      makeIssue({
        key: "EX-1",
        fixVersions: ["1.0.0"],
        statusCategory: "done",
        resolution: "Done",
      }),
    ],
    [{ name: "1.0.0", released: true, archived: false }],
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /without a release date/);
  assert.equal(findings[0].severity, "medium");
});

test("a version that holds no issues is reported as low severity", () => {
  const findings = findReleaseProblems(
    [],
    [{ name: "2.0.0", released: false, archived: false }],
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /holds no issues/);
  assert.equal(findings[0].severity, "low");
});

test("an archived version that holds no issues is not reported", () => {
  const findings = findReleaseProblems(
    [],
    [{ name: "0.9.0", released: true, releaseDate: "2025-01-01", archived: true }],
  );
  assert.deepEqual(findings, []);
});

test("a version is reported once per problem", () => {
  const findings = findReleaseProblems(
    [
      makeIssue({
        key: "EX-1",
        fixVersions: ["1.0.0"],
        statusCategory: "new",
      }),
    ],
    [{ name: "1.0.0", released: true, archived: false }],
  );
  // The open work and the missing release date are two problems.
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((finding) => finding.severity).sort(),
    ["high", "medium"],
  );
});

test("the issue key of a release finding is the version", () => {
  const findings = findReleaseProblems(
    [
      makeIssue({
        key: "EX-1",
        fixVersions: ["1.0.0"],
        statusCategory: "new",
      }),
    ],
    [VERSION],
  );
  assert.equal(findings[0].issueKey, "1.0.0");
});

test("a project with no versions has nothing to report", () => {
  assert.deepEqual(findReleaseProblems([makeIssue({ key: "EX-1" })], []), []);
});
