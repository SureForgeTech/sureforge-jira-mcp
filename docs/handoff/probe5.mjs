import { normalizeIssue } from "/workspace/sureforge-jira-mcp/dist/jira/normalize.js";

// What happens when the operator names a field that is not the epic link?
const issue = normalizeIssue(
  {
    key: "EX-1",
    fields: { project: { key: "EXAMPLE" }, summary: "s" },
  },
  "project",
);
console.log("named field 'project' ->", JSON.stringify(issue?.epicKey));

// A field that holds a plain string key.
console.log("string shape ->", JSON.stringify(normalizeIssue(
  { key: "EX-1", fields: { customfield_10100: "EX-9" } }, "customfield_10100")?.epicKey));

// An object without a key.
console.log("object without key ->", JSON.stringify(normalizeIssue(
  { key: "EX-1", fields: { customfield_10100: { id: "12" } } }, "customfield_10100")?.epicKey));

// The named field wins over the usual id.
console.log("named wins ->", JSON.stringify(normalizeIssue(
  { key: "EX-1", fields: { customfield_10100: { key: "EX-9" }, customfield_10014: { key: "EX-8" } } },
  "customfield_10100")?.epicKey));

// The named field is empty but the usual id is there.
console.log("named empty, usual present ->", JSON.stringify(normalizeIssue(
  { key: "EX-1", fields: { customfield_10100: null, customfield_10014: { key: "EX-8" } } },
  "customfield_10100")?.epicKey));

// The named field holds a non-key value and the usual id is there.
console.log("named junk, usual present ->", JSON.stringify(normalizeIssue(
  { key: "EX-1", fields: { customfield_10100: { name: "x" }, customfield_10014: { key: "EX-8" } } },
  "customfield_10100")?.epicKey));
