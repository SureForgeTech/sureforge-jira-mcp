import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeIssue,
  normalizeIssues,
  normalizeVersion,
  normalizeVersions,
} from "./normalize.js";

const payload = {
  id: "10001",
  key: "EX-1",
  fields: {
    summary: "A task",
    status: { name: "In Progress" },
    issuetype: { name: "Bug" },
    resolution: { name: "Fixed" },
    parent: { key: "EX-0" },
    fixVersions: [{ name: "1.0.0" }, { name: "1.1.0" }],
    labels: ["health", 42],
    created: "2026-01-01T00:00:00.000+0000",
    updated: "2026-01-02T00:00:00.000+0000",
    project: { key: "EX" },
    issuelinks: [
      { type: { name: "Blocks" }, outwardIssue: { key: "EX-2" } },
      { type: { name: "Relates" }, inwardIssue: { key: "EX-3" } },
    ],
    priority: { name: "High" },
    duedate: "2026-02-01",
  },
};

test("a full payload is normalized field by field", () => {
  const issue = normalizeIssue(payload);
  assert.ok(issue);
  assert.equal(issue.key, "EX-1");
  assert.equal(issue.id, "10001");
  assert.equal(issue.summary, "A task");
  assert.equal(issue.status, "In Progress");
  assert.equal(issue.issueType, "Bug");
  assert.equal(issue.resolution, "Fixed");
  assert.equal(issue.parentKey, "EX-0");
  assert.deepEqual([...issue.fixVersions], ["1.0.0", "1.1.0"]);
  assert.deepEqual([...issue.labels], ["health"]);
  assert.equal(issue.projectKey, "EX");
  assert.equal(issue.priority, "High");
  assert.equal(issue.dueDate, "2026-02-01");
});

test("both link directions are kept", () => {
  const issue = normalizeIssue(payload);
  assert.ok(issue);
  assert.equal(issue.issueLinks.length, 2);
  assert.deepEqual(issue.issueLinks[0], {
    type: "Blocks",
    direction: "outward",
    targetKey: "EX-2",
  });
  assert.deepEqual(issue.issueLinks[1], {
    type: "Relates",
    direction: "inward",
    targetKey: "EX-3",
  });
});

test("an issue without a key is dropped", () => {
  assert.equal(normalizeIssue({ id: "1", fields: {} }), undefined);
  assert.equal(normalizeIssue({ key: "", fields: {} }), undefined);
});

test("the epic link is read from the named field or from the custom field", () => {
  const named = normalizeIssue({
    key: "EX-1",
    fields: { epicLink: { key: "EX-9" } },
  });
  assert.equal(named?.epicKey, "EX-9");

  const custom = normalizeIssue({
    key: "EX-1",
    fields: { customfield_10014: { key: "EX-9" } },
  });
  assert.equal(custom?.epicKey, "EX-9");
});

test("the epic link is read when the custom field holds the key itself", () => {
  const custom = normalizeIssue({
    key: "EX-1",
    fields: { customfield_10014: "EX-9" },
  });
  assert.equal(custom?.epicKey, "EX-9");
});

test("an epic link that names nothing is left out", () => {
  const issue = normalizeIssue({
    key: "EX-1",
    fields: { customfield_10014: "" },
  });
  assert.equal(issue?.epicKey, undefined);
});

test("an issue without fields still normalizes", () => {
  const issue = normalizeIssue({ key: "EX-1" });
  assert.ok(issue);
  assert.equal(issue.status, "Unknown");
  assert.equal(issue.issueType, "Unknown");
  assert.equal(issue.resolution, undefined);
  assert.deepEqual([...issue.fixVersions], []);
  assert.deepEqual([...issue.issueLinks], []);
});

test("a link without an issue on the other end is dropped", () => {
  const issue = normalizeIssue({
    key: "EX-1",
    fields: { issuelinks: [{ type: { name: "Blocks" } }, null, "nonsense"] },
  });
  assert.ok(issue);
  assert.deepEqual([...issue.issueLinks], []);
});

test("a version without a name is dropped", () => {
  assert.equal(normalizeVersion({ released: true }), undefined);
  const version = normalizeVersion({
    name: "1.0.0",
    released: true,
    releaseDate: "2026-02-01",
  });
  assert.ok(version);
  assert.equal(version.released, true);
  assert.equal(version.releaseDate, "2026-02-01");
  assert.equal(version.archived, false);
});

test("lists of issues and versions ignore what is not a list", () => {
  assert.deepEqual(normalizeIssues("nonsense"), []);
  assert.deepEqual(normalizeVersions(undefined), []);
});

test("a list of issues drops the entries without a key", () => {
  const issues = normalizeIssues([payload, { id: "2" }, null]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].key, "EX-1");
});
