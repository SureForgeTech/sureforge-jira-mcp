import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daysSince,
  DEFAULT_RULE_OPTIONS,
  findBrokenHierarchies,
  findMissingReleaseVersions,
  findOrphanedIssues,
  findStaleBlockers,
  indexByKey,
  issuesPointingAt,
  type RuleOptions,
} from "./rules.js";
import { EXAMPLE_VERSIONS, makeIssue, NOW } from "../testing/fixtures.js";

const options: RuleOptions = { ...DEFAULT_RULE_OPTIONS, now: NOW };

test("an issue with no links at all is orphaned", () => {
  const findings = findOrphanedIssues([makeIssue({ key: "EX-1" })]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].issueKey, "EX-1");
  assert.equal(findings[0].category, "orphaned-issue");
});

test("a resolved issue is not orphaned", () => {
  const findings = findOrphanedIssues([
    makeIssue({ key: "EX-1", resolution: "Done" }),
  ]);
  assert.deepEqual(findings, []);
});

test("an issue with a parent is not orphaned", () => {
  const findings = findOrphanedIssues([
    makeIssue({ key: "EX-1", parentKey: "EX-0" }),
    makeIssue({ key: "EX-0" }),
  ]);
  assert.deepEqual(findings, []);
});

test("an issue with an epic is not orphaned", () => {
  const findings = findOrphanedIssues([
    makeIssue({ key: "EX-1", epicKey: "EX-9" }),
  ]);
  assert.deepEqual(findings, []);
});

test("an issue with an issue link is not orphaned", () => {
  const findings = findOrphanedIssues([
    makeIssue({
      key: "EX-1",
      issueLinks: [{ type: "Relates", direction: "outward", targetKey: "EX-2" }],
    }),
  ]);
  assert.deepEqual(findings, []);
});

test("an issue with a child is not orphaned", () => {
  const findings = findOrphanedIssues([
    makeIssue({ key: "EX-1" }),
    makeIssue({ key: "EX-2", parentKey: "EX-1" }),
  ]);
  assert.deepEqual(findings, []);
});

test("an epic that a task points at is not orphaned", () => {
  const findings = findOrphanedIssues([
    makeIssue({ key: "EX-1", epicKey: "EX-9" }),
    makeIssue({ key: "EX-9" }),
  ]);
  assert.deepEqual(findings, []);
});

test("an issue with an inward link is not orphaned", () => {
  const findings = findOrphanedIssues([
    makeIssue({
      key: "EX-1",
      issueLinks: [{ type: "Relates", direction: "inward", targetKey: "EX-2" }],
    }),
  ]);
  assert.deepEqual(findings, []);
});

test("an issue naming a version the project does not have is reported", () => {
  const findings = findMissingReleaseVersions(
    [makeIssue({ key: "EX-1", fixVersions: ["9.9.9"] })],
    EXAMPLE_VERSIONS,
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /9\.9\.9/);
});

test("an issue naming a known version is not reported", () => {
  const findings = findMissingReleaseVersions(
    [makeIssue({ key: "EX-1", fixVersions: ["1.1.0"] })],
    EXAMPLE_VERSIONS,
  );
  assert.deepEqual(findings, []);
});

test("an issue that ships while its parent carries no version is reported", () => {
  const findings = findMissingReleaseVersions(
    [
      makeIssue({ key: "EX-1", parentKey: "EX-0", fixVersions: ["1.1.0"] }),
      makeIssue({ key: "EX-0" }),
    ],
    EXAMPLE_VERSIONS,
  );
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].relatedKeys, ["EX-0"]);
});

test("an issue that ships with a version on its parent is not reported", () => {
  const findings = findMissingReleaseVersions(
    [
      makeIssue({ key: "EX-1", parentKey: "EX-0", fixVersions: ["1.1.0"] }),
      makeIssue({ key: "EX-0", fixVersions: ["1.1.0"] }),
    ],
    EXAMPLE_VERSIONS,
  );
  assert.deepEqual(findings, []);
});

test("a parent that is not part of the listing is not reported", () => {
  const findings = findMissingReleaseVersions(
    [makeIssue({ key: "EX-1", parentKey: "EX-404", fixVersions: ["1.1.0"] })],
    EXAMPLE_VERSIONS,
  );
  assert.deepEqual(findings, []);
});

test("an orphan in an incomplete listing is reported as low severity", () => {
  const findings = findOrphanedIssues([makeIssue({ key: "EX-1" })], {
    listingComplete: false,
    epicLinkKnown: true,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "low");
  assert.match(findings[0].detail, /no issue in the listing of 1 issues/);
});

test("an orphan in a complete listing is reported as medium severity", () => {
  const findings = findOrphanedIssues([makeIssue({ key: "EX-1" })], {
    listingComplete: true,
    epicLinkKnown: true,
  });
  assert.equal(findings[0].severity, "medium");
  assert.match(findings[0].detail, /no issue points at it/);
});

test("an orphan whose epic is not known does not state that it has no epic", () => {
  const findings = findOrphanedIssues([makeIssue({ key: "EX-1" })], {
    listingComplete: true,
    epicLinkKnown: false,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "low");
  assert.equal(
    findings[0].detail.includes("no epic"),
    false,
    "the epic relation is not known",
  );
  assert.match(findings[0].detail, /The epic of the issue is not known/);
});

test("a stale blocker of open work is reported", () => {
  const findings = findStaleBlockers(
    [
      makeIssue({
        key: "EX-1",
        updated: "2026-01-01T00:00:00.000Z",
        issueLinks: [
          { type: "Blocks", direction: "outward", targetKey: "EX-2" },
        ],
      }),
      makeIssue({ key: "EX-2" }),
    ],
    EXAMPLE_VERSIONS,
    { ...options, staleDays: 14 },
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].issueKey, "EX-1");
  assert.deepEqual(findings[0].relatedKeys, ["EX-2"]);
});

test("a blocker that was updated recently is not stale", () => {
  const findings = findStaleBlockers(
    [
      makeIssue({
        key: "EX-1",
        updated: "2026-02-28T00:00:00.000Z",
        issueLinks: [
          { type: "Blocks", direction: "outward", targetKey: "EX-2" },
        ],
      }),
      makeIssue({ key: "EX-2" }),
    ],
    EXAMPLE_VERSIONS,
    { ...options, staleDays: 14 },
  );
  assert.deepEqual(findings, []);
});

test("a blocker updated exactly on the threshold is stale", () => {
  const findings = findStaleBlockers(
    [
      makeIssue({
        key: "EX-1",
        updated: "2026-02-15T00:00:00.000Z",
        issueLinks: [
          { type: "Blocks", direction: "outward", targetKey: "EX-2" },
        ],
      }),
      makeIssue({ key: "EX-2" }),
    ],
    EXAMPLE_VERSIONS,
    { ...options, staleDays: 14 },
  );
  assert.equal(findings.length, 1);
});

test("a resolved blocker is not reported", () => {
  const findings = findStaleBlockers(
    [
      makeIssue({
        key: "EX-1",
        resolution: "Done",
        updated: "2026-01-01T00:00:00.000Z",
        issueLinks: [
          { type: "Blocks", direction: "outward", targetKey: "EX-2" },
        ],
      }),
      makeIssue({ key: "EX-2" }),
    ],
    EXAMPLE_VERSIONS,
    options,
  );
  assert.deepEqual(findings, []);
});

test("a blocker of work in a released version is high severity", () => {
  const findings = findStaleBlockers(
    [
      makeIssue({
        key: "EX-1",
        updated: "2026-01-01T00:00:00.000Z",
        issueLinks: [
          { type: "Blocks", direction: "outward", targetKey: "EX-2" },
        ],
      }),
      makeIssue({ key: "EX-2", fixVersions: ["1.0.0"] }),
    ],
    EXAMPLE_VERSIONS,
    options,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "high");
});

test("a blocker of work in an unreleased version is medium severity", () => {
  const findings = findStaleBlockers(
    [
      makeIssue({
        key: "EX-1",
        updated: "2026-01-01T00:00:00.000Z",
        issueLinks: [
          { type: "Blocks", direction: "outward", targetKey: "EX-2" },
        ],
      }),
      makeIssue({ key: "EX-2", fixVersions: ["2.0.0"] }),
    ],
    EXAMPLE_VERSIONS,
    options,
  );
  assert.equal(findings[0].severity, "medium");
});

test("an inward blocks link makes the other issue the blocker", () => {
  const findings = findStaleBlockers(
    [
      makeIssue({
        key: "EX-1",
        issueLinks: [
          { type: "Blocks", direction: "inward", targetKey: "EX-2" },
        ],
      }),
      makeIssue({ key: "EX-2", updated: "2026-01-01T00:00:00.000Z" }),
    ],
    EXAMPLE_VERSIONS,
    options,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].issueKey, "EX-2");
  assert.deepEqual(findings[0].relatedKeys, ["EX-1"]);
});

test("an is-blocked-by link makes the other issue the blocker", () => {
  const findings = findStaleBlockers(
    [
      makeIssue({
        key: "EX-1",
        issueLinks: [
          { type: "is blocked by", direction: "outward", targetKey: "EX-2" },
        ],
      }),
      makeIssue({ key: "EX-2", updated: "2026-01-01T00:00:00.000Z" }),
    ],
    EXAMPLE_VERSIONS,
    options,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].issueKey, "EX-2");
});

test("a blocking link to an issue outside the listing is skipped", () => {
  const findings = findStaleBlockers(
    [
      makeIssue({
        key: "EX-1",
        updated: "2026-01-01T00:00:00.000Z",
        issueLinks: [
          { type: "Blocks", direction: "outward", targetKey: "EX-404" },
        ],
      }),
    ],
    EXAMPLE_VERSIONS,
    options,
  );
  assert.deepEqual(findings, []);
});

test("a parent that does not exist is reported as a broken hierarchy", () => {
  const findings = findBrokenHierarchies(
    [makeIssue({ key: "EX-1", parentKey: "EX-404" })],
    options,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "high");
  assert.deepEqual(findings[0].relatedKeys, ["EX-404"]);
});

test("an epic that does not exist is reported as a broken hierarchy", () => {
  const findings = findBrokenHierarchies(
    [makeIssue({ key: "EX-1", epicKey: "EX-404" })],
    options,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
});

test("a parent chain that loops is reported once", () => {
  const findings = findBrokenHierarchies(
    [
      makeIssue({ key: "EX-1", parentKey: "EX-2" }),
      makeIssue({ key: "EX-2", parentKey: "EX-1" }),
      makeIssue({ key: "EX-3", parentKey: "EX-1" }),
    ],
    options,
  );
  const cycles = findings.filter((finding) =>
    finding.detail.startsWith("The parent chain loops"),
  );
  assert.equal(cycles.length, 1);
  assert.deepEqual([...cycles[0].relatedKeys].sort(), ["EX-1", "EX-2"]);
});

test("a hierarchy deeper than the limit is reported", () => {
  const issues = [
    makeIssue({ key: "EX-1", parentKey: "EX-2" }),
    makeIssue({ key: "EX-2", parentKey: "EX-3" }),
    makeIssue({ key: "EX-3", parentKey: "EX-4" }),
    makeIssue({ key: "EX-4" }),
  ];
  const findings = findBrokenHierarchies(issues, { ...options, maxDepth: 3 });
  const deep = findings.filter((finding) =>
    finding.detail.includes("levels deep"),
  );
  assert.equal(deep.length, 1);
  assert.equal(deep[0].issueKey, "EX-1");
  assert.match(deep[0].detail, /4 levels deep/);
});

test("a hierarchy exactly at the limit is not reported", () => {
  const issues = [
    makeIssue({ key: "EX-1", parentKey: "EX-2" }),
    makeIssue({ key: "EX-2", parentKey: "EX-3" }),
    makeIssue({ key: "EX-3" }),
  ];
  const findings = findBrokenHierarchies(issues, { ...options, maxDepth: 3 });
  assert.deepEqual(findings, []);
});

test("daysSince counts whole days and refuses an unreadable timestamp", () => {
  assert.equal(daysSince("2026-02-28T00:00:00.000Z", NOW), 1);
  assert.equal(daysSince("not-a-date", NOW), undefined);
});

test("the index and the pointing map cover every issue", () => {
  const issues = [
    makeIssue({ key: "EX-1", parentKey: "EX-0" }),
    makeIssue({ key: "EX-2", epicKey: "EX-0" }),
    makeIssue({ key: "EX-0" }),
  ];
  assert.equal(indexByKey(issues).size, 3);
  assert.deepEqual(
    [...(issuesPointingAt(issues).get("EX-0") ?? [])].sort(),
    ["EX-1", "EX-2"],
  );
});

test("a blocking relation reported from both ends is reported once", () => {
  const findings = findStaleBlockers(
    [
      makeIssue({
        key: "EX-1",
        updated: "2026-01-01T00:00:00.000Z",
        issueLinks: [
          { type: "Blocks", direction: "outward", targetKey: "EX-2" },
        ],
      }),
      makeIssue({
        key: "EX-2",
        issueLinks: [
          { type: "Blocks", direction: "inward", targetKey: "EX-1" },
        ],
      }),
    ],
    EXAMPLE_VERSIONS,
    options,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].issueKey, "EX-1");
  assert.deepEqual(findings[0].relatedKeys, ["EX-2"]);
});

test("a missing parent in an incomplete listing is reported as low severity", () => {
  const findings = findBrokenHierarchies(
    [makeIssue({ key: "EX-1", parentKey: "EX-404" })],
    { ...options, listingComplete: false, epicLinkKnown: true },
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "low");
  assert.match(findings[0].detail, /does not cover the whole project/);
});

test("a missing parent in a complete listing is reported as high severity", () => {
  const findings = findBrokenHierarchies(
    [makeIssue({ key: "EX-1", parentKey: "EX-404" })],
    { ...options, listingComplete: true, epicLinkKnown: true },
  );
  assert.equal(findings[0].severity, "high");
  assert.match(findings[0].detail, /does not exist/);
});