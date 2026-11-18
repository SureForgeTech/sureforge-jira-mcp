import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildProjectJql,
  JiraClient,
  JiraError,
  normalizeBaseUrl,
} from "./client.js";

interface RecordedRequest {
  url: URL;
  authorization: string | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A `fetch` that answers from a queue and records what it was asked. */
function fakeFetch(
  responses: Array<Response | (() => Response | Promise<Response>)>,
): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  let index = 0;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({
      url,
      authorization:
        init?.headers === undefined
          ? undefined
          : new Headers(init.headers).get("authorization") ?? undefined,
    });
    const next = responses[index];
    index += 1;
    if (next === undefined) {
      throw new Error(`no response prepared for ${url}`);
    }
    return typeof next === "function" ? next() : next;
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function client(fetchImpl: typeof fetch, maxIssues = 500): JiraClient {
  return new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "reader@example.com",
    apiToken: "example-token-value",
    fetchImpl,
    maxIssues,
  });
}

test("the base URL loses a trailing slash and a REST suffix", () => {
  assert.equal(
    normalizeBaseUrl("https://example.atlassian.net/"),
    "https://example.atlassian.net",
  );
  assert.equal(
    normalizeBaseUrl("https://example.atlassian.net/rest/api/3"),
    "https://example.atlassian.net",
  );
  assert.equal(
    normalizeBaseUrl("https://example.atlassian.net/rest/api/3/"),
    "https://example.atlassian.net",
  );
});

test("the project JQL quotes the key and keeps an extra filter", () => {
  assert.equal(buildProjectJql("EX"), 'project = "EX"');
  assert.equal(
    buildProjectJql("EX", "status != Done"),
    'project = "EX" AND (status != Done)',
  );
});

test("listing issues asks the search endpoint for the project", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }] }),
  ]);
  const issues = await client(fetchImpl).listIssues("EX");

  assert.equal(issues.length, 1);
  assert.equal(issues[0].key, "EX-1");
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url.pathname,
    "/rest/api/3/search/jql",
  );
  assert.equal(requests[0].url.searchParams.get("jql"), 'project = "EX"');
});

test("the request carries the basic authorization header", async () => {
  const { fetchImpl, requests } = fakeFetch([jsonResponse({ issues: [] })]);
  await client(fetchImpl).listIssues("EX");

  const authorization = requests[0].authorization;
  assert.ok(authorization !== undefined);
  assert.ok(authorization.startsWith("Basic "));
  const decoded = Buffer.from(
    authorization.slice("Basic ".length),
    "base64",
  ).toString("utf8");
  assert.equal(decoded, "reader@example.com:example-token-value");
});

test("listing issues reads every page", async () => {
  const first = Array.from({ length: 100 }, (_, index) => ({
    key: `EX-${index}`,
    fields: {},
  }));
  const second = [{ key: "EX-100", fields: {} }];
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ issues: first }),
    jsonResponse({ issues: second }),
  ]);

  const issues = await client(fetchImpl).listIssues("EX");
  assert.equal(issues.length, 101);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url.searchParams.get("startAt"), "100");
});

test("listing issues stops at the configured limit", async () => {
  const page = Array.from({ length: 100 }, (_, index) => ({
    key: `EX-${index}`,
    fields: {},
  }));
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ issues: page }),
    jsonResponse({ issues: page }),
  ]);

  const issues = await client(fetchImpl, 150).listIssues("EX");
  assert.equal(issues.length, 150);
  assert.equal(requests.length, 2);
});

test("the earlier search endpoint is used when the site does not know the current one", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }] }),
  ]);

  const issues = await client(fetchImpl).listIssues("EX");
  assert.equal(issues.length, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.pathname, "/rest/api/3/search/jql");
  assert.equal(requests[1].url.pathname, "/rest/api/3/search");
});

test("an error from Jira is reported with its status", async () => {
  const { fetchImpl } = fakeFetch([jsonResponse({ message: "nope" }, 401)]);
  await assert.rejects(
    () => client(fetchImpl).listIssues("EX"),
    (error: unknown) =>
      error instanceof JiraError && error.status === 401 && /401/.test(error.message),
  );
});

test("an error message never carries the token", async () => {
  const { fetchImpl } = fakeFetch([jsonResponse({ message: "nope" }, 403)]);
  await assert.rejects(
    () => client(fetchImpl).listIssues("EX"),
    (error: unknown) => {
      assert.equal(
        error instanceof Error && error.message.includes("example-token-value"),
        false,
      );
      return true;
    },
  );
});

test("a transport failure is reported as a Jira error", async () => {
  const { fetchImpl } = fakeFetch([
    () => {
      throw new Error("connection refused");
    },
  ]);
  await assert.rejects(
    () => client(fetchImpl).listIssues("EX"),
    (error: unknown) =>
      error instanceof JiraError && /connection refused/.test(error.message),
  );
});

test("a body that is not JSON is reported as a Jira error", async () => {
  const { fetchImpl } = fakeFetch([
    new Response("<html>not json</html>", { status: 200 }),
  ]);
  await assert.rejects(
    () => client(fetchImpl).listIssues("EX"),
    (error: unknown) =>
      error instanceof JiraError && /not JSON/.test(error.message),
  );
});

test("listing versions reads the project versions", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse([
      { name: "1.0.0", released: true },
      { name: "1.1.0", released: false },
    ]),
  ]);

  const versions = await client(fetchImpl).listVersions("EX");
  assert.equal(versions.length, 2);
  assert.equal(versions[0].name, "1.0.0");
  assert.equal(
    requests[0].url.pathname,
    "/rest/api/3/project/EX/versions",
  );
});
