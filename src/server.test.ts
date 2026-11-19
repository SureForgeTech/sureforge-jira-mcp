import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createJiraServer, TOOL_NAMES, type JiraReader } from "./server.js";
import type { Issue, ProjectVersion } from "./jira/types.js";
import { EXAMPLE_VERSIONS, makeIssue, NOW } from "./testing/fixtures.js";

const ISSUES: Issue[] = [
  makeIssue({ key: "EX-1" }),
  makeIssue({ key: "EX-2", parentKey: "EX-1", fixVersions: ["1.1.0"] }),
  makeIssue({
    key: "EX-3",
    updated: "2026-01-01T00:00:00.000Z",
    issueLinks: [{ type: "Blocks", direction: "outward", targetKey: "EX-4" }],
  }),
  makeIssue({ key: "EX-4", fixVersions: ["1.0.0"] }),
  makeIssue({ key: "EX-5", parentKey: "EX-404" }),
  makeIssue({ key: "EX-6", fixVersions: ["9.9.9"] }),
];

/** A reader that answers from the example fixtures. */
function reader(overrides?: Partial<JiraReader>): JiraReader {
  return {
    listIssues: async () => ({
      issues: ISSUES,
      truncated: false,
      dropped: 0, epicLinkKnown: true,
      examined: ISSUES.length,
    }),
    listVersions: async (): Promise<ProjectVersion[]> => EXAMPLE_VERSIONS,
    ...overrides,
  };
}

/** Connect a client to a fresh server over an in-memory transport. */
async function connect(source: JiraReader): Promise<{
  client: Client;
  close: () => Promise<void>;
}> {
  const server = createJiraServer({
    reader: source,
    projectKey: "EXAMPLE",
    staleDays: 14,
    maxDepth: 5,
    now: () => NOW,
    secrets: ["example-token-value"],
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Read the JSON payload a tool returned. */
function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ text: string }> }).content;
  assert.equal(content.length, 1);
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

test("the server publishes exactly the five health tools", async () => {
  const { client, close } = await connect(reader());
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [...TOOL_NAMES].sort(),
    );
  } finally {
    await close();
  }
});

test("every tool is announced as read-only", async () => {
  const { client, close } = await connect(reader());
  try {
    const tools = await client.listTools();
    for (const tool of tools.tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    }
  } finally {
    await close();
  }
});

test("the orphaned issue tool reports the issues that stand on their own", async () => {
  const { client, close } = await connect(reader());
  try {
    const result = await client.callTool({
      name: "jira_find_orphaned_issues",
      arguments: {},
    });
    const body = payload(result);
    assert.equal(body.projectKey, "EXAMPLE");
    const findings = body.findings as Array<{ issueKey: string }>;
    // EX-1 has a child, EX-2 has a parent, EX-3 has a link and EX-5 has a
    // parent, so only EX-4 and EX-6 stand on their own.
    assert.deepEqual(
      findings.map((finding) => finding.issueKey),
      ["EX-4", "EX-6"],
    );
  } finally {
    await close();
  }
});

test("the missing release version tool reports the unknown version", async () => {
  const { client, close } = await connect(reader());
  try {
    const result = await client.callTool({
      name: "jira_find_missing_release_versions",
      arguments: {},
    });
    const findings = payload(result).findings as Array<{
      issueKey: string;
      detail: string;
    }>;
    assert.deepEqual(
      findings.map((finding) => finding.issueKey),
      ["EX-2", "EX-6"],
    );
  } finally {
    await close();
  }
});

test("the stale blocker tool reports the blocker of released work", async () => {
  const { client, close } = await connect(reader());
  try {
    const result = await client.callTool({
      name: "jira_find_stale_blockers",
      arguments: {},
    });
    const findings = payload(result).findings as Array<{
      issueKey: string;
      severity: string;
    }>;
    assert.deepEqual(
      findings.map((finding) => finding.issueKey),
      ["EX-3"],
    );
    assert.equal(findings[0].severity, "high");
  } finally {
    await close();
  }
});

test("the stale blocker tool takes a threshold of its own", async () => {
  const { client, close } = await connect(reader());
  try {
    const result = await client.callTool({
      name: "jira_find_stale_blockers",
      arguments: { staleDays: 1 },
    });
    const findings = payload(result).findings as Array<{ issueKey: string }>;
    assert.deepEqual(
      findings.map((finding) => finding.issueKey),
      ["EX-3"],
    );
  } finally {
    await close();
  }
});

test("the broken hierarchy tool reports the missing parent", async () => {
  const { client, close } = await connect(reader());
  try {
    const result = await client.callTool({
      name: "jira_find_broken_hierarchies",
      arguments: {},
    });
    const findings = payload(result).findings as Array<{
      issueKey: string;
      severity: string;
    }>;
    assert.deepEqual(
      findings.map((finding) => finding.issueKey),
      ["EX-5"],
    );
    assert.equal(findings[0].severity, "high");
  } finally {
    await close();
  }
});

test("the summary counts every category", async () => {
  const { client, close } = await connect(reader());
  try {
    const result = await client.callTool({
      name: "jira_health_summary",
      arguments: {},
    });
    const body = payload(result);
    assert.equal(body.status, "needs-attention");
    assert.equal(body.projectKey, "EXAMPLE");
    assert.deepEqual(body.byCategory, {
      "orphaned-issue": 2,
      "missing-release-version": 2,
      "stale-blocker": 1,
      "broken-hierarchy": 1,
    });
    assert.equal(body.total, 6);
  } finally {
    await close();
  }
});

test("the summary is healthy when there is nothing to report", async () => {
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({ issues: [], truncated: false, dropped: 0, epicLinkKnown: true, examined: 0 }),
      listVersions: async () => [],
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_health_summary",
      arguments: {},
    });
    assert.equal(payload(result).status, "healthy");
  } finally {
    await close();
  }
});

test("the tools report how many issues they looked at", async () => {
  const { client, close } = await connect(reader());
  try {
    const result = await client.callTool({
      name: "jira_find_orphaned_issues",
      arguments: {},
    });
    const body = payload(result);
    assert.equal(body.issuesExamined, ISSUES.length);
    assert.equal(body.truncated, undefined);
  } finally {
    await close();
  }
});

test("a truncated listing is reported and softens the missing parent finding", async () => {
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({
        issues: ISSUES,
        truncated: true,
        dropped: 0, epicLinkKnown: true,
        examined: ISSUES.length,
      }),
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_find_broken_hierarchies",
      arguments: {},
    });
    const body = payload(result);
    assert.equal(body.truncated, true);
    const findings = body.findings as Array<{
      severity: string;
      detail: string;
    }>;
    assert.equal(findings[0].severity, "low");
    assert.match(findings[0].detail, /does not cover the whole project/);
  } finally {
    await close();
  }
});

test("a limit keeps the findings that matter, not the ones that come first", async () => {
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({
        issues: [
          // A medium finding first: EX-1 blocks work in a version that is
          // not released, so it is medium.
          makeIssue({
            key: "EX-1",
            updated: "2026-01-01T00:00:00.000Z",
            issueLinks: [
              { type: "Blocks", direction: "outward", targetKey: "EX-3" },
            ],
          }),
          // A high finding second: EX-2 blocks work in a released version.
          makeIssue({
            key: "EX-2",
            updated: "2026-01-01T00:00:00.000Z",
            issueLinks: [
              { type: "Blocks", direction: "outward", targetKey: "EX-4" },
            ],
          }),
          makeIssue({ key: "EX-3", fixVersions: ["2.0.0"] }),
          makeIssue({ key: "EX-4", fixVersions: ["1.0.0"] }),
        ],
        truncated: false,
        dropped: 0, epicLinkKnown: true,
        examined: 4,
      }),
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_find_stale_blockers",
      arguments: { limit: 1 },
    });
    const findings = payload(result).findings as Array<{
      issueKey: string;
      severity: string;
    }>;
    assert.equal(findings.length, 1);
    assert.equal(findings[0].issueKey, "EX-2");
    assert.equal(findings[0].severity, "high");
  } finally {
    await close();
  }
});

test("a truncated listing softens the orphan finding", async () => {
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({
        issues: [makeIssue({ key: "EX-1" })],
        truncated: true,
        dropped: 0, epicLinkKnown: true,
        examined: 1,
      }),
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_find_orphaned_issues",
      arguments: {},
    });
    const body = payload(result);
    assert.equal(body.truncated, true);
    const findings = body.findings as Array<{
      severity: string;
      detail: string;
    }>;
    assert.equal(findings[0].severity, "low");
    assert.match(findings[0].detail, /no issue in the listing of 1 issues/);
  } finally {
    await close();
  }
});

test("the tools that do not use the versions do not ask for them", async () => {
  const { client, close } = await connect(
    reader({
      listVersions: async () => {
        throw new Error("the versions endpoint must not be called here");
      },
    }),
  );
  try {
    const orphaned = await client.callTool({
      name: "jira_find_orphaned_issues",
      arguments: {},
    });
    assert.notEqual((orphaned as { isError?: boolean }).isError, true);

    const hierarchies = await client.callTool({
      name: "jira_find_broken_hierarchies",
      arguments: {},
    });
    assert.notEqual((hierarchies as { isError?: boolean }).isError, true);
  } finally {
    await close();
  }
});

test("the tools that use the versions still ask for them", async () => {
  const { client, close } = await connect(reader());
  try {
    const result = await client.callTool({
      name: "jira_find_missing_release_versions",
      arguments: {},
    });
    const findings = payload(result).findings as Array<{ issueKey: string }>;
    assert.deepEqual(
      findings.map((finding) => finding.issueKey),
      ["EX-2", "EX-6"],
    );
  } finally {
    await close();
  }
});

test("a listing that does not know the epic relation softens the findings", async () => {
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({
        issues: [makeIssue({ key: "EX-1" })],
        truncated: false,
        dropped: 0,
        examined: 1,
        // The site refused the Epic Link field, so the epic relation is
        // unknown and the findings cannot state that there is no epic.
        epicLinkKnown: false,
      }),
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_find_orphaned_issues",
      arguments: {},
    });
    const body = payload(result);
    assert.equal(body.epicLinkKnown, false);
    const findings = body.findings as Array<{
      severity: string;
      detail: string;
    }>;
    assert.equal(findings[0].severity, "low");
    // The listing covers the project, so the finding does not claim that it
    // does not; what it cannot say is whether the issue has an epic, or
    // whether the issues that point at it are all listed.
    assert.doesNotMatch(findings[0].detail, /does not cover the whole project/);
    assert.match(findings[0].detail, /epic relation could not be read/);
  } finally {
    await close();
  }
});

test("the result says how many issues the site left out", async () => {
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({
        issues: [makeIssue({ key: "EX-1" })],
        truncated: true,
        dropped: 3,
        examined: 1,
        epicLinkKnown: true,
      }),
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_find_orphaned_issues",
      arguments: {},
    });
    const body = payload(result);
    assert.equal(body.issuesDropped, 3);
    assert.equal(body.truncated, true);
  } finally {
    await close();
  }
});

test("the tools accept another project key", async () => {
  const asked: string[] = [];
  const { client, close } = await connect(
    reader({
      listIssues: async (projectKey: string) => {
        asked.push(projectKey);
        return { issues: [], truncated: false, dropped: 0, epicLinkKnown: true, examined: 0 };
      },
    }),
  );
  try {
    await client.callTool({
      name: "jira_health_summary",
      arguments: { projectKey: "other" },
    });
    assert.ok(asked.includes("OTHER"));
  } finally {
    await close();
  }
});

test("a failure from Jira is reported as a tool error", async () => {
  const { client, close } = await connect(
    reader({
      listIssues: async () => {
        throw new Error("Jira answered 401 Unauthorized");
      },
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_health_summary",
      arguments: {},
    });
    assert.equal((result as { isError?: boolean }).isError, true);
  } finally {
    await close();
  }
});

test("an error message never carries the token", async () => {
  const { client, close } = await connect(
    reader({
      listIssues: async () => {
        throw new Error("failed for token example-token-value");
      },
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_health_summary",
      arguments: {},
    });
    const content = (result as { content: Array<{ text: string }> }).content;
    assert.equal(content[0].text.includes("example-token-value"), false);
    assert.match(content[0].text, /\*\*\*/);
  } finally {
    await close();
  }
});

test("a limit that is not a positive number is refused", async () => {
  const { client, close } = await connect(reader());
  try {
    const result = await client.callTool({
      name: "jira_find_orphaned_issues",
      arguments: { limit: 0 },
    });
    assert.equal((result as { isError?: boolean }).isError, true);
  } finally {
    await close();
  }
});

test("a listing that left issues out says how many", async () => {
  // The count is part of the report: a listing that dropped issues is
  // incomplete, and the tool says how many were left out.
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({
        issues: ISSUES,
        truncated: false,
        dropped: 3,
        epicLinkKnown: true,
        examined: ISSUES.length,
      }),
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_find_orphaned_issues",
      arguments: {},
    });
    const body = payload(result);
    assert.equal(body.issuesDropped, 3);
  } finally {
    await close();
  }
});

test("a missing parent stays high when the listing is complete but the epic relation is unknown", async () => {
  // The listing covers the whole project, so a parent that is not in it
  // does not exist. The epic relation being unknown says nothing about
  // that, and must not downgrade the finding.
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({
        issues: [makeIssue({ key: "EX-7", parentKey: "EX-404" })],
        truncated: false,
        dropped: 0,
        epicLinkKnown: false,
        examined: 1,
      }),
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_find_broken_hierarchies",
      arguments: {},
    });
    const body = payload(result);
    const findings = body.findings as Array<{
      category: string;
      severity: string;
      detail: string;
    }>;
    const hierarchy = findings.find((f) => f.category === "broken-hierarchy");
    assert.equal(hierarchy?.severity, "high");
    assert.match(hierarchy?.detail ?? "", /The parent EX-404 does not exist\./);
  } finally {
    await close();
  }
});

test("an unknown epic relation is hedged where it is used", async () => {
  // The listing is complete, but the epic relation was not read: the
  // findings that depend on it are hedged, and the listing is not
  // described as if it were missing issues.
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({
        issues: [makeIssue({ key: "EX-8", epicKey: "EX-999" })],
        truncated: false,
        dropped: 0,
        epicLinkKnown: false,
        examined: 1,
      }),
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_find_broken_hierarchies",
      arguments: {},
    });
    const body = payload(result);
    const findings = body.findings as Array<{
      category: string;
      severity: string;
      detail: string;
    }>;
    const hierarchy = findings.find((f) => f.category === "broken-hierarchy");
    assert.equal(hierarchy?.severity, "low");
    assert.match(hierarchy?.detail ?? "", /epic relation could not be read/);
    // The listing covers the project, so it is not described as if it did
    // not.
    assert.doesNotMatch(hierarchy?.detail ?? "", /does not cover the whole project/);
  } finally {
    await close();
  }
});

test("an orphan says what it cannot know about the epic relation", async () => {
  // The listing is complete, but the epic relation was not read, so the
  // finding must not claim that the issue has no epic, and must not claim
  // that nothing points at it: an epic's children point at it through the
  // link that was not read.
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({
        issues: [makeIssue({ key: "EX-9" })],
        truncated: false,
        dropped: 0,
        epicLinkKnown: false,
        examined: 1,
      }),
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_find_orphaned_issues",
      arguments: {},
    });
    const body = payload(result);
    const findings = body.findings as Array<{
      category: string;
      severity: string;
      detail: string;
    }>;
    const orphan = findings.find((f) => f.category === "orphaned-issue");
    assert.equal(orphan?.severity, "low");
    assert.doesNotMatch(orphan?.detail ?? "", /no epic/);
    assert.match(orphan?.detail ?? "", /epic relation could not be read/);
  } finally {
    await close();
  }
});

test("an orphan says the listing does not cover the project and the epic is unknown", async () => {
  // Both unknowns at once: the listing may be missing issues, and the
  // epic relation was not read. The finding says what is unknown, and
  // does not claim that the listing points at nothing.
  const { client, close } = await connect(
    reader({
      listIssues: async () => ({
        issues: [makeIssue({ key: "EX-1" })],
        truncated: true,
        dropped: 0,
        epicLinkKnown: false,
        examined: 1,
      }),
    }),
  );
  try {
    const result = await client.callTool({
      name: "jira_find_orphaned_issues",
      arguments: {},
    });
    const body = payload(result);
    const findings = body.findings as Array<{ severity: string; detail: string }>;
    assert.equal(findings[0].severity, "low");
    assert.match(findings[0].detail, /epic relation could not be read/);
    assert.match(findings[0].detail, /listing does not cover the whole project/);
    assert.doesNotMatch(findings[0].detail, /no issue in the listing of \d+ issues points at it/);
  } finally {
    await close();
  }
});
