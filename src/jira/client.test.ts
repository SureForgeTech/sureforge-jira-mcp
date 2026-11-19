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
  // Every page holds a different issue, so the site keeps offering more and
  // the listing runs into the page cap.
  let call = 0;
  const { fetchImpl } = fakeFetch(
    [
      () => {
        call += 1;
        return jsonResponse({
          issues: [{ key: `EX-${call}`, fields: {} }],
          isLast: false,
          nextPageToken: `token-${call}`,
        });
      },
    ],
    { repeatLast: true },
  );

  const listing = await client(fetchImpl, 5000).listIssues("EX");
  assert.equal(listing.truncated, true);
  assert.equal(listing.issues.length, 50);
});

test("a site that repeats the same page ends the listing instead of repeating it", async () => {
  const { fetchImpl, requests } = fakeFetch(
    [
      () =>
        jsonResponse({
          issues: [{ key: "EX-1", fields: {} }],
          isLast: false,
          nextPageToken: "the-same-token",
        }),
    ],
    { repeatLast: true },
  );

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(requests.length, 2, "the repeated page is not read again and again");
  assert.equal(listing.issues.length, 1);
  assert.equal(listing.truncated, true);
});

test("the offset path reports a listing that stops short of the project as truncated", async () => {
  // The cursor endpoint is unknown, the site answers with a total of 500.
  const { fetchImpl } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: pageOfIssues(100), total: 500 }),
    jsonResponse({ issues: pageOfIssues(50, 100), total: 500 }),
  ]);

  const listing = await client(fetchImpl, 150).listIssues("EX");
  assert.equal(listing.issues.length, 150);
  assert.equal(
    listing.truncated,
    true,
    "the project holds 500 issues and only 150 were read",
  );
});

test("the offset path stops when the total is read", async () => {
  const { fetchImpl } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: pageOfIssues(100), total: 150 }),
    jsonResponse({ issues: pageOfIssues(50, 100), total: 150 }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(listing.issues.length, 150);
  assert.equal(listing.truncated, false);
});

test("a cursor page that says there is more but gives no token is truncated", async () => {
  const { fetchImpl } = fakeFetch([
    jsonResponse({ issues: pageOfIssues(10), isLast: false }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(listing.issues.length, 10);
  assert.equal(listing.truncated, true);
});

test("a cursor page that is empty while the site says there is more is truncated", async () => {
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: pageOfIssues(10),
      isLast: false,
      nextPageToken: "second",
    }),
    jsonResponse({ issues: [], isLast: false, nextPageToken: "third" }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(listing.issues.length, 10);
  assert.equal(listing.truncated, true);
});

test("an empty page ends the offset listing even when the total is larger", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: [], total: 500 }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(listing.issues.length, 0);
  assert.equal(
    requests.length,
    2,
    "the client must not ask for the same empty page again and again",
  );
  assert.equal(
    listing.truncated,
    true,
    "the site states the project holds more issues, so the listing is incomplete",
  );
});

test("an empty page after some issues is an incomplete listing", async () => {
  const { fetchImpl } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], total: 3 }),
    jsonResponse({ issues: [], total: 3 }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(listing.issues.length, 1);
  assert.equal(listing.truncated, true);
});

test("the offset path keeps reading when a page holds issues without a key", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({
      issues: [
        { key: "EX-1", fields: {} },
        { id: "2", fields: {} },
        { id: "3", fields: {} },
      ],
      total: 6,
    }),
    jsonResponse({
      issues: [
        { key: "EX-4", fields: {} },
        { id: "5", fields: {} },
        { key: "EX-6", fields: {} },
      ],
      total: 6,
    }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(requests.length, 3, "the second page was read as well");
  assert.deepEqual(
    listing.issues.map((issue) => issue.key),
    ["EX-1", "EX-4", "EX-6"],
  );
  assert.equal(
    listing.truncated,
    true,
    "the site returned issues without a key, so the listing is incomplete",
  );
  assert.equal(listing.dropped, 3);
});

test("the offset path keeps reading when no issue of a page has a key", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    // A full page of issues that carry no key: the site answered the whole
    // page, so there is more to read.
    jsonResponse({
      issues: Array.from({ length: 100 }, (_, index) => ({
        id: String(index),
        fields: {},
      })),
    }),
    jsonResponse({
      issues: [{ key: "EX-4", fields: {} }],
    }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(
    requests.length,
    3,
    "a page whose issues have no key must not end the listing",
  );
  assert.deepEqual(
    listing.issues.map((issue) => issue.key),
    ["EX-4"],
  );
});

test("the issues the cap cut off count as dropped", async () => {
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: pageOfIssues(100),
      isLast: false,
      nextPageToken: "more",
    }),
  ]);

  const listing = await client(fetchImpl, 40).listIssues("EX");
  assert.equal(listing.issues.length, 40);
  assert.equal(
    listing.dropped,
    60,
    "the issues the cap cut off are lost and count as dropped",
  );
  assert.equal(listing.truncated, true);
});

test("the offset path stops when the site repeats a page", async () => {
  const { fetchImpl, requests } = fakeFetch(
    [
      jsonResponse({ message: "not found" }, 404),
      () =>
        jsonResponse({
          issues: [{ key: "EX-1", fields: {} }],
          total: 500,
        }),
    ],
    { repeatLast: true },
  );

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(
    requests.length,
    3,
    "the repeated page is not read again and again",
  );
  assert.equal(listing.issues.length, 1);
  assert.equal(listing.truncated, true);
});

test("a field id that names a field the server always asks for is ignored", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ issues: [], isLast: true }),
  ]);
  const jira = new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "reader@example.com",
    apiToken: "example-token-value",
    fetchImpl,
    epicLinkField: "project",
  });

  await jira.listIssues("EX");
  const fields = requests[0].url.searchParams.get("fields") ?? "";
  assert.equal(
    fields.split(",").filter((name) => name === "project").length,
    1,
    "the field is asked for once, as a base field",
  );
});

test("a site that refuses the Epic Link field is read without it", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "unknown field" }, 400),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], isLast: true }),
  ]);

  const listing = await client(fetchImpl).listIssues("EX");
  assert.equal(listing.issues.length, 1);
  assert.equal(requests.length, 2);
  assert.ok(
    requests[0].url.searchParams.get("fields")?.includes("customfield_10014"),
    "the first request asks for the Epic Link field",
  );
  assert.equal(
    requests[1].url.searchParams.get("fields")?.includes("customfield_10014"),
    false,
    "the second request does not ask for it any more",
  );
});

test("the Epic Link field can be named by the configuration", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ issues: [], isLast: true }),
  ]);
  const jira = new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "reader@example.com",
    apiToken: "example-token-value",
    fetchImpl,
    epicLinkField: "customfield_10100",
  });

  await jira.listIssues("EX");
  assert.ok(
    requests[0].url.searchParams.get("fields")?.includes("customfield_10100"),
  );
});

test("the value of the configured Epic Link field is read", async () => {
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: [
        {
          key: "EX-1",
          fields: { customfield_10100: { key: "EX-9" } },
        },
      ],
      isLast: true,
    }),
  ]);
  const jira = new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "reader@example.com",
    apiToken: "example-token-value",
    fetchImpl,
    epicLinkField: "customfield_10100",
  });

  const listing = await jira.listIssues("EX");
  assert.equal(listing.issues[0].epicKey, "EX-9");
});

test("a site that refuses the Epic Link field says the epic relation is unknown", async () => {
  const { fetchImpl } = fakeFetch([
    jsonResponse({ message: "unknown field" }, 400),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], isLast: true }),
  ]);

  const listing = await client(fetchImpl).listIssues("EX");
  assert.equal(listing.epicLinkKnown, false);
  assert.equal(listing.issues.length, 1);
});

test("the refusal is answered on the earlier endpoint as well", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ message: "unknown field" }, 400),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], total: 1 }),
  ]);

  const listing = await client(fetchImpl).listIssues("EX");
  assert.equal(listing.issues.length, 1);
  assert.equal(listing.epicLinkKnown, false);
  assert.equal(requests.length, 3);
});

test("the cursor path keeps reading when a page holds issues without a key", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({
      issues: Array.from({ length: 100 }, (_, index) => ({
        id: String(index),
        fields: {},
      })),
      isLast: false,
      nextPageToken: "second",
    }),
    jsonResponse({
      issues: [{ key: "EX-1", fields: {} }],
      isLast: true,
    }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(requests.length, 2, "the second page was read as well");
  assert.deepEqual(
    listing.issues.map((issue) => issue.key),
    ["EX-1"],
  );
});

test("the offset path without a total that ends on a short page is incomplete", async () => {
  const { fetchImpl } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }] }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(
    listing.truncated,
    true,
    "a short page without a total cannot prove that the project was read",
  );
});

test("the offset moves by the issues the site returned, not by the ones kept", async () => {
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({
      issues: [
        { key: "EX-1", fields: {} },
        { id: "2", fields: {} },
        { key: "EX-3", fields: {} },
      ],
      total: 6,
    }),
    jsonResponse({
      issues: [
        { key: "EX-4", fields: {} },
        { id: "5", fields: {} },
        { key: "EX-6", fields: {} },
      ],
      total: 6,
    }),
  ]);

  const listing = await client(fetchImpl, 500).listIssues("EX");
  assert.equal(requests[2].url.searchParams.get("startAt"), "3");
  assert.deepEqual(
    listing.issues.map((issue) => issue.key),
    ["EX-1", "EX-3", "EX-4", "EX-6"],
  );
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

test("an unrelated 400 does not blame the Epic Link field", async () => {
  // The site refuses the request for a reason of its own. The listing
  // fails - the retry without the field fails too - and the field is not
  // blamed for it: the next listing still asks for the field, so the epic
  // relation is not lost for the rest of the process.
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "bad request" }, 400),
    jsonResponse({ message: "bad request" }, 400),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], isLast: true }),
  ]);

  const site = client(fetchImpl);
  await assert.rejects(() => site.listIssues("EX"));
  assert.equal(requests.length, 2, "the listing was retried without the field");

  const listing = await site.listIssues("EX");
  assert.equal(listing.epicLinkKnown, true);
  assert.ok(
    requests[2]?.url.searchParams.get("fields")?.includes("customfield_10014"),
    "the next listing still asks for the Epic Link field",
  );
});

test("a field id that names a field the server always asks for is not read as the epic link", async () => {
  // The id is ignored in the request, so it must be ignored in the reading
  // too: otherwise the value of that field would become the epic relation
  // and every issue would look like it had an epic.
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: [
        { key: "EX-1", fields: { project: { key: "EX" }, summary: "Example issue" } },
      ],
      isLast: true,
    }),
  ]);

  const site = new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "reader@example.com",
    apiToken: "example-token-value",
    fetchImpl,
    epicLinkField: "project",
  });
  const listing = await site.listIssues("EX");
  assert.equal(listing.epicLinkKnown, true);
  assert.equal(listing.issues[0]?.epicKey, undefined);
});

test("a field id that names a base field falls back to the documented default", async () => {
  // The named id is ignored, but the epic relation is still read: the
  // default is asked for, so the listing can say the relation is known
  // because it is.
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({
      issues: [{ key: "EX-1", fields: { customfield_10014: "EX-9" } }],
      isLast: true,
    }),
  ]);

  const site = new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "reader@example.com",
    apiToken: "example-token-value",
    fetchImpl,
    epicLinkField: "project",
  });
  const listing = await site.listIssues("EX");
  assert.ok(
    requests[0]?.url.searchParams.get("fields")?.includes("customfield_10014"),
    "the default epic field is asked for",
  );
  assert.equal(listing.epicLinkKnown, true);
  assert.equal(listing.issues[0]?.epicKey, "EX-9");
});

test("a site that repeats a page ends the listing without a total", async () => {
  // The site does not know the cursor endpoint and returns no total, and
  // then repeats the same page. The listing must end there, not after
  // fifty requests.
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "unknown endpoint" }, 404),
    jsonResponse({ issues: pageOfIssues(100, 0) }),
    jsonResponse({ issues: pageOfIssues(100, 0) }),
  ]);

  const listing = await client(fetchImpl).listIssues("EX");
  assert.equal(requests.length, 3, `the listing must stop, requests: ${requests.length}`);
  assert.equal(listing.truncated, true);
});

test("a field that holds free text is not read as the epic link", async () => {
  // The operator named a field, but the field holds a team name rather
  // than the key of an epic. Reading it as a relation would report an
  // epic that does not exist, and would hide every real orphan.
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: [
        { key: "EX-1", fields: { customfield_10016: "Team A", summary: "Example issue" } },
      ],
      isLast: true,
    }),
  ]);

  const site = new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "reader@example.com",
    apiToken: "example-token-value",
    fetchImpl,
    epicLinkField: "customfield_10016",
  });
  const listing = await site.listIssues("EX");
  assert.equal(listing.issues[0]?.epicKey, undefined);
});

test("a field whose value cannot be an epic leaves the relation unknown", async () => {
  // The site answered, but the field holds a value that is not an issue
  // key. The relation was not read, so the listing says so - and the
  // findings that depend on it are hedged instead of stating that the
  // issue has no epic.
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: [
        { key: "EX-1", fields: { customfield_10016: "Team A", summary: "Example issue" } },
      ],
      isLast: true,
    }),
  ]);

  const site = new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "reader@example.com",
    apiToken: "example-token-value",
    fetchImpl,
    epicLinkField: "customfield_10016",
  });
  const listing = await site.listIssues("EX");
  assert.equal(listing.issues[0]?.epicKey, undefined);
  assert.equal(listing.epicLinkKnown, false);
});

test("an issue repeated within one page is counted once", async () => {
  // The site's page holds the same issue twice. It is one issue, and the
  // listing reports it once.
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: [
        { key: "EX-1", fields: { summary: "Example issue" } },
        { key: "EX-1", fields: { summary: "Example issue" } },
      ],
      isLast: true,
    }),
  ]);

  const listing = await client(fetchImpl).listIssues("EX");
  assert.equal(listing.issues.length, 1);
  assert.equal(listing.examined, 1);
});

test("a field that cannot be an epic on any issue of a page leaves the relation unknown", async () => {
  // The field holds a value on one issue of the page and nothing on the
  // next, so the relation was not read for the first one either.
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: [
        { key: "EX-1", fields: { summary: "Example issue" } },
        { key: "EX-2", fields: { customfield_10016: "Team A", summary: "Example issue" } },
      ],
      isLast: true,
    }),
  ]);

  const site = new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "reader@example.com",
    apiToken: "example-token-value",
    fetchImpl,
    epicLinkField: "customfield_10016",
  });
  const listing = await site.listIssues("EX");
  assert.equal(listing.epicLinkKnown, false);
});

test("a field whose value is not a key at all leaves the relation unknown", async () => {
  // A number, a list and a select list are values the relation cannot be
  // read from, so the relation was not read.
  for (const value of [5, ["Team A"], { value: "Team A" }, { key: 5 }]) {
    const { fetchImpl } = fakeFetch([
      jsonResponse({
        issues: [{ key: "EX-1", fields: { customfield_10016: value, summary: "Example" } }],
        isLast: true,
      }),
    ]);
    const site = new JiraClient({
      baseUrl: "https://example.atlassian.net",
      email: "reader@example.com",
      apiToken: "example-token-value",
      fetchImpl,
      epicLinkField: "customfield_10016",
    });
    const listing = await site.listIssues("EX");
    assert.equal(
      listing.epicLinkKnown,
      false,
      `a value of ${JSON.stringify(value)} cannot be an epic relation`,
    );
  }
});
