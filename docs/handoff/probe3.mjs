import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createJiraServer } from "/workspace/sureforge-jira-mcp/dist/server.js";

const makeIssue = (o) => ({
  id: o.key,
  summary: `Summary for ${o.key}`,
  status: "To Do",
  issueType: "Task",
  fixVersions: [],
  labels: [],
  created: "2026-01-01T00:00:00.000Z",
  updated: "2026-01-01T00:00:00.000Z",
  projectKey: "EXAMPLE",
  issueLinks: [],
  ...o,
});

// An issue that really has an epic on the site, but the site refused the field,
// so the server never learned about it.
const ISSUES = [
  makeIssue({ key: "EX-1", epicKey: "EX-9" }),
  makeIssue({ key: "EX-2" }),
];

async function run(label, listing) {
  const server = createJiraServer({
    reader: {
      listIssues: async () => listing,
      listVersions: async () => [{ name: "1.0.0", released: true }],
    },
    projectKey: "EXAMPLE",
    staleDays: 14,
    maxDepth: 5,
    now: () => new Date("2026-03-01T00:00:00.000Z"),
    secrets: ["example-token-value"],
  });
  const client = new Client({ name: "probe", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  const out = {};
  for (const tool of [
    "jira_find_orphaned_issues",
    "jira_find_broken_hierarchies",
    "jira_health_summary",
  ]) {
    const result = await client.callTool({ name: tool, arguments: {} });
    out[tool] = JSON.parse(result.content[0].text);
  }
  await client.close();
  await server.close();
  console.log("=== " + label);
  console.log(JSON.stringify(out, null, 2));
}

await run("epicLinkKnown = false, truncated = false", {
  issues: ISSUES,
  truncated: false,
  dropped: 0,
  examined: ISSUES.length,
  epicLinkKnown: false,
});

await run("epicLinkKnown = true, truncated = false", {
  issues: ISSUES,
  truncated: false,
  dropped: 0,
  examined: ISSUES.length,
  epicLinkKnown: true,
});
