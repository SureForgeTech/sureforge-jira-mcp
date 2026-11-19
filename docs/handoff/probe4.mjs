import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JiraClient } from "/workspace/sureforge-jira-mcp/dist/jira/client.js";
import { createJiraServer } from "/workspace/sureforge-jira-mcp/dist/server.js";

// A site that refuses the Epic Link field, then serves the project without it.
// The two tasks really belong to the epic EX-9 on the site; the server never
// gets to learn that.
const ISSUES = [
  {
    id: "1",
    key: "EX-1",
    fields: {
      summary: "A task that really belongs to epic EX-9",
      status: { name: "To Do" },
      issuetype: { name: "Task" },
      project: { key: "EXAMPLE" },
      created: "2026-01-01T00:00:00.000+0000",
      updated: "2026-01-01T00:00:00.000+0000",
      fixVersions: [],
      labels: [],
      issuelinks: [],
      // the epic relation lives under another id on this site, so it is
      // never asked for and never served
      customfield_10100: { key: "EX-9" },
    },
  },
];

const seen = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  seen.push(url.pathname + "?" + url.searchParams.toString());
  if (url.searchParams.get("fields")?.includes("customfield_10014")) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ errorMessages: ["Field 'customfield_10014' does not exist"] }));
    return;
  }
  response.end(JSON.stringify({ issues: ISSUES, isLast: true }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const jira = new JiraClient({
  baseUrl: `http://127.0.0.1:${port}`,
  email: "reader@example.com",
  apiToken: "example-token-value",
});

const mcp = createJiraServer({
  reader: jira,
  projectKey: "EXAMPLE",
  staleDays: 14,
  maxDepth: 5,
  now: () => new Date("2026-03-01T00:00:00.000Z"),
  secrets: ["example-token-value"],
});
const client = new Client({ name: "probe", version: "1.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([client.connect(ct), mcp.connect(st)]);

const result = await client.callTool({
  name: "jira_find_orphaned_issues",
  arguments: {},
});
console.log("requests seen by the site:");
for (const r of seen) console.log("  ", r);
console.log("\njira_find_orphaned_issues result:");
console.log(JSON.stringify(JSON.parse(result.content[0].text), null, 2));

await client.close();
await mcp.close();
server.close();
