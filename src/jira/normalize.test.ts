import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeIssue,
  normalizeIssues,
  normalizeProject,
  normalizeServerInfo,
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

test("the assignee is read from the account", () => {
  const named = normalizeIssue({
    key: "EX-1",
    fields: { assignee: { displayName: "A Person", accountId: "abc" } },
  });
  assert.equal(named?.assignee, "A Person");

  const legacy = normalizeIssue({
    key: "EX-1",
    fields: { assignee: { name: "aperson", key: "aperson" } },
  });
  assert.equal(legacy?.assignee, "aperson");

  const unassigned = normalizeIssue({
    key: "EX-1",
    fields: { assignee: null },
  });
  assert.equal(unassigned?.assignee, undefined);
});

test("an assignee the site does not name is still an assignee", () => {
  const issue = normalizeIssue({
    key: "EX-1",
    fields: { assignee: { accountId: "5b10a2844c20165700ede21g" } },
  });
  assert.equal(issue?.assigned, true);
  assert.equal(issue?.assignee, "5b10a2844c20165700ede21g");
});

test("an unassigned issue is not assigned", () => {
  const issue = normalizeIssue({ key: "EX-1", fields: { assignee: null } });
  assert.equal(issue?.assigned, false);
  assert.equal(issue?.assignee, undefined);
});

test("the sub-task flag is read from the issue type", () => {
  const subTask = normalizeIssue({
    key: "EX-1",
    fields: { issuetype: { name: "Sub-task", subtask: true } },
  });
  assert.equal(subTask?.subTask, true);

  const task = normalizeIssue({
    key: "EX-1",
    fields: { issuetype: { name: "Task", subtask: false } },
  });
  assert.equal(task?.subTask, false);
});

test("the description is read as present or absent", () => {
  const withText = normalizeIssue({
    key: "EX-1",
    fields: { description: "What has to happen." },
  });
  assert.equal(withText?.descriptionPresent, true);

  const emptyText = normalizeIssue({
    key: "EX-1",
    fields: { description: "   " },
  });
  assert.equal(emptyText?.descriptionPresent, false);

  const emptyDocument = normalizeIssue({
    key: "EX-1",
    fields: { description: { type: "doc", version: 1, content: [] } },
  });
  assert.equal(emptyDocument?.descriptionPresent, false);

  const documentWithoutContent = normalizeIssue({
    key: "EX-1",
    fields: { description: { type: "doc", version: 1 } },
  });
  assert.equal(documentWithoutContent?.descriptionPresent, false);

  const blankDocument = normalizeIssue({
    key: "EX-1",
    fields: {
      description: {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: "   " }] },
        ],
      },
    },
  });
  assert.equal(blankDocument?.descriptionPresent, false);

  const document = normalizeIssue({
    key: "EX-1",
    fields: {
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "What has to happen." }],
          },
        ],
      },
    },
  });
  assert.equal(document?.descriptionPresent, true);

  const none = normalizeIssue({ key: "EX-1", fields: {} });
  assert.equal(none?.descriptionPresent, false);
});

test("the status category is read from the status", () => {
  const done = normalizeIssue({
    key: "EX-1",
    fields: { status: { name: "Done", statusCategory: { key: "done" } } },
  });
  assert.equal(done?.statusCategory, "done");

  const progress = normalizeIssue({
    key: "EX-1",
    fields: { status: { name: "In Progress", statusCategory: { key: "indeterminate" } } },
  });
  assert.equal(progress?.statusCategory, "indeterminate");

  const todo = normalizeIssue({
    key: "EX-1",
    fields: { status: { name: "To Do", statusCategory: { key: "new" } } },
  });
  assert.equal(todo?.statusCategory, "new");

  const unknown = normalizeIssue({ key: "EX-1", fields: { status: { name: "Odd" } } });
  assert.equal(unknown?.statusCategory, undefined);

  const missing = normalizeIssue({ key: "EX-1", fields: {} });
  assert.equal(missing?.statusCategory, undefined);
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

test("the epic link is read from the field the caller names", () => {
  const issue = normalizeIssue(
    { key: "EX-1", fields: { customfield_10100: { key: "EX-9" } } },
    "customfield_10100",
  );
  assert.equal(issue?.epicKey, "EX-9");
});

test("the field the caller names wins over the usual id", () => {
  const issue = normalizeIssue(
    {
      key: "EX-1",
      fields: {
        customfield_10100: { key: "EX-9" },
        customfield_10014: { key: "EX-8" },
      },
    },
    "customfield_10100",
  );
  assert.equal(issue?.epicKey, "EX-9");
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

test("the server info is normalized with the health checks", () => {
  const info = normalizeServerInfo({
    baseUrl: "https://example.atlassian.net",
    version: "1001.0.0",
    versionNumbers: [1001, 0, 0],
    deploymentType: "Cloud",
    buildNumber: 1001,
    serverTitle: "Jira",
    healthChecks: [
      { name: "Database", description: "Connected", passed: true },
      { name: "Disk", passed: false },
    ],
  });
  assert.equal(info.deploymentType, "Cloud");
  assert.equal(info.buildNumber, 1001);
  assert.equal(info.healthChecks.length, 2);
  assert.equal(info.healthChecks[1].passed, false);
  assert.equal(info.healthChecks[0].description, "Connected");
});

test("a server info without fields keeps what it was given", () => {
  const info = normalizeServerInfo({});
  assert.equal(info.deploymentType, undefined);
  assert.deepEqual([...info.healthChecks], []);
  assert.equal(normalizeServerInfo("nonsense").healthChecks.length, 0);
});

test("a health check without a name is left out", () => {
  const info = normalizeServerInfo({ healthChecks: [{ passed: true }, null] });
  assert.equal(info.healthChecks.length, 0);
});

test("the project is normalized with its issue types", () => {
  const project = normalizeProject({
    key: "EXAMPLE",
    name: "Example project",
    projectTypeKey: "software",
    issueTypes: [{ name: "Task" }, { name: "Bug" }, {}],
  });
  assert.equal(project?.key, "EXAMPLE");
  assert.deepEqual([...(project?.issueTypes ?? [])], ["Task", "Bug"]);
});

test("a project without a key is not a project", () => {
  assert.equal(normalizeProject({ name: "No key" }), undefined);
  assert.equal(normalizeProject("nonsense"), undefined);
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
