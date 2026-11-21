/**
 * The end-to-end smoke test.
 *
 * It spawns the built server and speaks MCP over its standard input and
 * output, the way a host would, while a local mock Jira answers on
 * loopback. Nothing leaves the machine: no account, no credential and no
 * network beyond 127.0.0.1. The token is an invented value and is never
 * printed.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverBuild = join(here, "..", "dist", "index.js");

// An invented token. It is asserted in place, never printed.
const DUMMY_TOKEN = "example-e2e-dummy-token";

const MOCK_ISSUES = [
  {
    id: "1",
    key: "EX-1",
    fields: {
      summary: "An issue that stands alone",
      status: { name: "To Do" },
      issuetype: { name: "Task" },
      project: { key: "EXAMPLE" },
      created: "2026-01-01T00:00:00.000+0000",
      updated: "2026-01-01T00:00:00.000+0000",
      fixVersions: [],
      labels: [],
      issuelinks: [],
    },
  },
  {
    id: "2",
    key: "EX-2",
    fields: {
      summary: "An issue with a parent that is gone",
      status: { name: "In Progress" },
      issuetype: { name: "Task" },
      project: { key: "EXAMPLE" },
      created: "2026-01-01T00:00:00.000+0000",
      updated: "2026-01-01T00:00:00.000+0000",
      fixVersions: [{ name: "1.0.0" }],
      labels: [],
      issuelinks: [],
      parent: { key: "EX-404" },
    },
  },
];

/**
 * Start the mock Jira.
 *
 * It answers the search endpoint and the versions endpoint, and it refuses a
 * request that does not carry the expected basic authorization header.
 */
function startMockJira() {
  const seen = { requests: 0, authorized: false };

  const server = createServer((request, response) => {
    seen.requests += 1;
    const authorization = request.headers.authorization ?? "";
    const expected = `Basic ${Buffer.from(`reader@example.com:${DUMMY_TOKEN}`).toString("base64")}`;
    if (authorization !== expected) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "unauthorized" }));
      return;
    }
    seen.authorized = true;

    response.writeHead(200, { "content-type": "application/json" });
    if (request.url?.includes("/serverInfo")) {
      response.end(
        JSON.stringify({
          baseUrl: "http://127.0.0.1:0",
          version: "1001.0.0",
          versionNumbers: [1001, 0, 0],
          deploymentType: "Cloud",
          buildNumber: 1001,
          serverTitle: "Jira",
          healthChecks: [],
        }),
      );
      return;
    }
    if (request.url?.includes("/versions")) {
      response.end(
        JSON.stringify([
          { name: "1.0.0", released: true, releaseDate: "2026-02-01" },
          { name: "1.1.0", released: false },
        ]),
      );
      return;
    }
    if (request.url?.includes("/project/")) {
      response.end(
        JSON.stringify({
          key: "EXAMPLE",
          name: "Example project",
          projectTypeKey: "software",
          issueTypes: [{ name: "Task" }],
        }),
      );
      return;
    }
    // The shape of the current search endpoint: the last page says so, so
    // the listing is a complete one and the findings are not softened.
    response.end(
      JSON.stringify({ issues: MOCK_ISSUES, total: MOCK_ISSUES.length, isLast: true }),
    );
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        seen,
        close: () => new Promise((done) => server.close(() => done(undefined))),
      });
    });
  });
}

/** Read the JSON a tool returned. */
function payload(result) {
  assert.equal(result.content.length, 1);
  return JSON.parse(result.content[0].text);
}

test("the built server answers the health tools over stdio", async (t) => {
  if (!existsSync(serverBuild)) {
    t.skip(`the server is not built: ${serverBuild} is missing`);
    return;
  }

  const mock = await startMockJira();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverBuild],
    env: {
      ...process.env,
      JIRA_BASE_URL: mock.baseUrl,
      JIRA_EMAIL: "reader@example.com",
      JIRA_API_TOKEN: DUMMY_TOKEN,
      JIRA_PROJECT_KEY: "EXAMPLE",
    },
    stderr: "pipe",
  });

  const client = new Client({ name: "e2e-client", version: "1.0.0" });
  await client.connect(transport);

  t.after(async () => {
    await client.close();
    await mock.close();
  });

  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    [
      "jira_check_installation",
      "jira_find_broken_hierarchies",
      "jira_find_missing_release_versions",
      "jira_find_orphaned_issues",
      "jira_find_stale_blockers",
      "jira_health_summary",
    ],
  );

  const installation = payload(
    await client.callTool({ name: "jira_check_installation", arguments: {} }),
  );
  assert.equal(installation.status, "healthy");
  assert.equal(installation.deployment.type, "cloud");
  assert.equal(installation.project.found, true);

  const orphaned = payload(
    await client.callTool({ name: "jira_find_orphaned_issues", arguments: {} }),
  );
  assert.equal(orphaned.count, 1);
  assert.equal(orphaned.findings[0].issueKey, "EX-1");

  const hierarchies = payload(
    await client.callTool({
      name: "jira_find_broken_hierarchies",
      arguments: {},
    }),
  );
  assert.equal(hierarchies.count, 1);
  assert.equal(hierarchies.findings[0].issueKey, "EX-2");

  const summary = payload(
    await client.callTool({ name: "jira_health_summary", arguments: {} }),
  );
  assert.equal(summary.status, "needs-attention");
  assert.equal(summary.total, 2);
  assert.equal(summary.projectKey, "EXAMPLE");
  assert.equal(
    summary.truncated,
    undefined,
    "the listing was complete, so the findings are not softened",
  );

  assert.ok(mock.seen.requests >= 3, "the mock Jira was asked for the data");
  assert.equal(mock.seen.authorized, true, "the request carried the credentials");
});

test("the server refuses to start without a configuration", async (t) => {
  if (!existsSync(serverBuild)) {
    t.skip(`the server is not built: ${serverBuild} is missing`);
    return;
  }

  const child = spawn(process.execPath, [serverBuild], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const code = await new Promise((resolve) => {
    child.on("close", (exitCode) => resolve(exitCode));
  });

  assert.equal(code, 2);
  assert.match(stderr, /JIRA_BASE_URL/);
  assert.equal(stderr.includes(DUMMY_TOKEN), false);
});
