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
  options?: { repeatLast?: boolean },
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
    let next = responses[index];
    index += 1;
    if (next === undefined && options?.repeatLast === true) {
      next = responses[responses.length - 1];
    }
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

/** A page of `count` issues. */
function pageOfIssues(count: number, offset = 0): Array<{
  key: string;
  fields: Record<string, never>;
}> {
  return Array.from({ length: count }, (_, index) => ({
    key: `EX-${offset + index}`,
    fields: {},
  }));
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
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], isLast: true }),
  ]);
  const listing = await client(fetchImpl).listIssues("EX");

  assert.equal(listing.issues.length, 1);
  assert.equal(listing.issues[0].key, "EX-1");
  assert.equal(listing.truncated, false);
  assert.equal(listing.examined, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.pathname, "/rest/api/3/search/jql");
  assert.equal(requests[0].url.searchParams.get("jql"), 'project = "EX"');
});

test("the request carries the basic authorization header", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ issues: [], isLast: true }),
  ]);
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

test("the cursor endpoint is read page by page with its token", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({
      issues: pageOfIssues(100),
      isLast: false,
      nextPageToken: "token-of-the-second-page",
    }),
    jsonResponse({ issues: pageOfIssues(1, 100), isLast: true }),
  ]);

  const listing = await client(fetchImpl).listIssues("EX");
  assert.equal(listing.issues.length, 101);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].url.searchParams.get("nextPageToken"),
    null,
    "the first page has no token",
  );
  assert.equal(
    requests[1].url.searchParams.get("nextPageToken"),
    "token-of-the-second-page",
  );
  assert.equal(
    requests[1].url.searchParams.get("startAt"),
    null,
    "the cursor endpoint is not asked for an offset",
  );
});

test("the earlier search endpoint is used when the site does not know the current one", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], total: 1 }),
  ]);

  const listing = await client(fetchImpl).listIssues("EX");
  assert.equal(listing.issues.length, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.pathname, "/rest/api/3/search/jql");
  assert.equal(requests[1].url.pathname, "/rest/api/3/search");
});

test("a retired endpoint also falls back to the earlier one", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "gone" }, 410),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], total: 1 }),
  ]);

  const listing = await client(fetchImpl).listIssues("EX");
  assert.equal(listing.issues.length, 1);
  assert.equal(requests[1].url.pathname, "/rest/api/3/search");
});

test("the endpoint that worked is remembered, so later pages cost one request", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: pageOfIssues(100), total: 200 }),
    jsonResponse({ issues: pageOfIssues(100, 100), total: 200 }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(listing.issues.length, 200);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].url.pathname, "/rest/api/3/search");
  assert.equal(requests[2].url.searchParams.get("startAt"), "100");
});

test("a listing that reaches the cap is marked as truncated", async () => {
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: pageOfIssues(100),
      isLast: false,
      nextPageToken: "more",
    }),
    jsonResponse({
      issues: pageOfIssues(100, 100),
      isLast: false,
      nextPageToken: "more",
    }),
  ]);

  const listing = await client(fetchImpl, 150).listIssues("EX");
  assert.equal(listing.issues.length, 150);
  assert.equal(listing.truncated, true);
  assert.equal(listing.examined, 150);
});

test("a listing that ends exactly at the cap is not truncated", async () => {
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: pageOfIssues(100),
      isLast: false,
      nextPageToken: "more",
    }),
    jsonResponse({ issues: pageOfIssues(50, 100), isLast: true }),
  ]);

  const listing = await client(fetchImpl, 150).listIssues("EX");
  assert.equal(listing.issues.length, 150);
  assert.equal(
    listing.truncated,
    false,
    "the site said this was the last page",
  );
});

test("a listing that stops at the page cap is marked as truncated", async () => {
  const { fetchImpl } = fakeFetch(
    [
      () =>
        jsonResponse({
          issues: pageOfIssues(1),
          isLast: false,
          nextPageToken: "more",
        }),
    ],
    { repeatLast: true },
  );

  const listing = await client(fetchImpl, 5000).listIssues("EX");
  assert.equal(listing.truncated, true);
  assert.equal(listing.issues.length, 50);
});

test("an error from Jira is reported with its status", async () => {
  const { fetchImpl } = fakeFetch([jsonResponse({ message: "nope" }, 401)]);
  await assert.rejects(
    () => client(fetchImpl).listIssues("EX"),
    (error: unknown) =>
      error instanceof JiraError &&
      error.status === 401 &&
      /401/.test(error.message),
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
