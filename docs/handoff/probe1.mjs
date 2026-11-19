import { JiraClient } from "/workspace/sureforge-jira-mcp/dist/jira/client.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(responses, options) {
  const requests = [];
  let index = 0;
  const fetchImpl = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push({ url, method: init?.method });
    let next = responses[index];
    index += 1;
    if (next === undefined && options?.repeatLast === true) {
      next = responses[responses.length - 1];
    }
    if (next === undefined) throw new Error(`no response prepared for ${url}`);
    return typeof next === "function" ? next() : next;
  };
  return { fetchImpl, requests };
}

const client = (fetchImpl, maxIssues = 500) =>
  new JiraClient({
    baseUrl: "https://example.atlassian.net",
    email: "reader@example.com",
    apiToken: "example-token-value",
    fetchImpl,
    maxIssues,
  });

const show = (label, value) => console.log(label, JSON.stringify(value));

// ---- A: the site over-delivers (returns more issues than maxResults) ----
{
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: Array.from({ length: 100 }, (_, i) => ({ key: `EX-${i}`, fields: {} })),
      isLast: true,
    }),
  ]);
  const listing = await client(fetchImpl, 50).listIssues("EX");
  show("A over-delivery: {issues,truncated,examined,dropped}", {
    issues: listing.issues.length,
    truncated: listing.truncated,
    examined: listing.examined,
    dropped: listing.dropped,
    epicLinkKnown: listing.epicLinkKnown,
  });
}

// ---- B: the site refuses twice (400 both times) ----
{
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "unknown field" }, 400),
    jsonResponse({ message: "unknown field" }, 400),
  ]);
  try {
    await client(fetchImpl).listIssues("EX");
    show("B persistent 400", "NO ERROR (listing returned)");
  } catch (error) {
    show("B persistent 400", { message: error.message, status: error.status, requests: requests.length });
  }
}

// ---- C: 400 on the first page, then 200 without the field: what cursor is reused? ----
{
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], isLast: false, nextPageToken: "t1" }),
    jsonResponse({ message: "unknown field" }, 400),
    jsonResponse({ issues: [{ key: "EX-2", fields: {} }], isLast: true }),
  ]);
  const listing = await client(fetchImpl).listIssues("EX");
  show("C refusal on page 2", {
    issues: listing.issues.map((i) => i.key),
    truncated: listing.truncated,
    epicLinkKnown: listing.epicLinkKnown,
    requests: requests.map((r) => ({
      path: r.url.pathname,
      token: r.url.searchParams.get("nextPageToken"),
      startAt: r.url.searchParams.get("startAt"),
      epic: r.url.searchParams.get("fields")?.includes("customfield_10014"),
    })),
  });
}

// ---- D: offset path, no total, short page ----
{
  const { fetchImpl } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }] }),
  ]);
  const listing = await client(fetchImpl).listIssues("EX");
  show("D offset no total short page", {
    issues: listing.issues.length,
    truncated: listing.truncated,
    dropped: listing.dropped,
  });
}

// ---- E: offset path with total, exactly reached ----
{
  const { fetchImpl } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], total: 1 }),
  ]);
  const listing = await client(fetchImpl).listIssues("EX");
  show("E offset total reached", {
    issues: listing.issues.length,
    truncated: listing.truncated,
  });
}

// ---- F: cursor path, site answers isLast:false with no token on the first page ----
{
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], isLast: false }),
  ]);
  const listing = await client(fetchImpl).listIssues("EX");
  show("F cursor isLast false no token", {
    issues: listing.issues.length,
    truncated: listing.truncated,
    requests: requests.length,
  });
}

// ---- G: cursor path, repeated page detected ----
{
  const { fetchImpl, requests } = fakeFetch(
    [() => jsonResponse({ issues: [{ key: "EX-1", fields: {} }], isLast: false, nextPageToken: "same" })],
    { repeatLast: true },
  );
  const listing = await client(fetchImpl).listIssues("EX");
  show("G repeated page", {
    issues: listing.issues.length,
    truncated: listing.truncated,
    requests: requests.length,
  });
}

// ---- H: cursor path, partially repeated page (one new key) ----
{
  let n = 0;
  const { fetchImpl, requests } = fakeFetch([
    () => {
      n += 1;
      return jsonResponse({
        issues: n === 1
          ? [{ key: "EX-1", fields: {} }, { key: "EX-2", fields: {} }]
          : [{ key: "EX-1", fields: {} }, { key: "EX-3", fields: {} }],
        isLast: false,
        nextPageToken: `t${n}`,
      });
    },
  ]);
  const listing = await client(fetchImpl).listIssues("EX");
  show("H partially repeated page", {
    issues: listing.issues.map((i) => i.key),
    truncated: listing.truncated,
    requests: requests.length,
  });
}

// ---- I: 400 refusal on a site that actually means "bad JQL" (retry also 400) ----
{
  const { fetchImpl } = fakeFetch([
    jsonResponse({ message: "bad jql" }, 400),
    jsonResponse({ message: "bad jql" }, 400),
  ]);
  try {
    await client(fetchImpl).listIssues("EX");
    show("I bad jql", "NO ERROR");
  } catch (error) {
    show("I bad jql", { message: error.message, status: error.status });
  }
}

// ---- J: 400 refusal where the site 400s only the first request (transient) ----
{
  const { fetchImpl } = fakeFetch([
    jsonResponse({ message: "boom" }, 400),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], isLast: true }),
  ]);
  const listing = await client(fetchImpl).listIssues("EX");
  show("J transient 400", {
    issues: listing.issues.length,
    truncated: listing.truncated,
    epicLinkKnown: listing.epicLinkKnown,
  });
}
