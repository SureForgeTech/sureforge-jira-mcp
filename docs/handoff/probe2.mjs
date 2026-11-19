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

// ---- H: cursor path, partially repeated page (one new key) ----
{
  let n = 0;
  const { fetchImpl, requests } = fakeFetch(
    [
      () => {
        n += 1;
        return jsonResponse({
          issues:
            n === 1
              ? [{ key: "EX-1", fields: {} }, { key: "EX-2", fields: {} }]
              : [{ key: "EX-1", fields: {} }, { key: "EX-3", fields: {} }],
          isLast: false,
          nextPageToken: `t${n}`,
        });
      },
    ],
    { repeatLast: true },
  );
  const listing = await client(fetchImpl).listIssues("EX");
  show("H partially repeated page", {
    issues: listing.issues.map((i) => i.key),
    truncated: listing.truncated,
    requests: requests.length,
  });
}

// ---- I: 400 refusal where the site means "bad JQL" (retry also 400) ----
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

// ---- K: 404 on the cursor path, 404 on the offset path ----
{
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ message: "not found" }, 404),
  ]);
  try {
    await client(fetchImpl).listIssues("EX");
    show("K 404 both", "NO ERROR");
  } catch (error) {
    show("K 404 both", { message: error.message, status: error.status, requests: requests.length });
  }
}

// ---- L: the site refuses the field on the cursor path with 404 (field unknown as 404) ----
{
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ message: "not found" }, 404),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], total: 1 }),
  ]);
  try {
    const listing = await client(fetchImpl).listIssues("EX");
    show("L 404 refusal shape", {
      issues: listing.issues.length,
      epicLinkKnown: listing.epicLinkKnown,
      truncated: listing.truncated,
      requests: requests.length,
    });
  } catch (error) {
    show("L 404 refusal shape", { message: error.message, status: error.status, requests: requests.length });
  }
}

// ---- M: two listings on the same client after a refusal: the field is not asked again ----
{
  const { fetchImpl, requests } = fakeFetch([
    jsonResponse({ message: "unknown field" }, 400),
    jsonResponse({ issues: [{ key: "EX-1", fields: {} }], isLast: true }),
    jsonResponse({ issues: [{ key: "EX-2", fields: {} }], isLast: true }),
  ]);
  const jira = client(fetchImpl);
  const first = await jira.listIssues("EX");
  const second = await jira.listIssues("EX");
  show("M second listing", {
    first: { issues: first.issues.length, epicLinkKnown: first.epicLinkKnown },
    second: { issues: second.issues.length, epicLinkKnown: second.epicLinkKnown },
    fieldsAsked: requests.map((r) => r.url.searchParams.get("fields")?.includes("customfield_10014")),
  });
}

// ---- N: an issue whose key is missing is dropped and counted ----
{
  const { fetchImpl } = fakeFetch([
    jsonResponse({
      issues: [{ key: "EX-1", fields: {} }, { id: "2", fields: {} }],
      isLast: true,
    }),
  ]);
  const listing = await client(fetchImpl).listIssues("EX");
  show("N keyless issue", {
    issues: listing.issues.length,
    dropped: listing.dropped,
    truncated: listing.truncated,
  });
}
