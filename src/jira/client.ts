/**
 * The Jira REST client.
 *
 * The client owns the transport: authentication, timeouts, pagination and
 * error mapping. The `fetch` implementation is injectable, so the tests
 * drive the real request-building and response-handling code against a local
 * mock instead of a live Jira.
 */
import { normalizeIssues, normalizeVersions } from "./normalize.js";
import type { Issue, IssueListing, ProjectVersion } from "./types.js";

/** An error raised by the Jira API or by the transport around it. */
export class JiraError extends Error {
  /** The HTTP status, when the failure came from a response. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "JiraError";
    if (status !== undefined) {
      this.status = status;
    }
  }
}

/** How the client is configured. */
export interface JiraClientOptions {
  /** The Jira site, for example `https://example.atlassian.net`. */
  readonly baseUrl: string;
  /** The account email used for basic authentication. */
  readonly email: string;
  /** The API token used for basic authentication. */
  readonly apiToken: string;
  /** The `fetch` implementation; defaults to the global one. */
  readonly fetchImpl?: typeof fetch;
  /** The request timeout in milliseconds; defaults to 15000. */
  readonly timeoutMs?: number;
  /** The largest number of issues one listing may return; defaults to 2000. */
  readonly maxIssues?: number;
}

/** The fields the health rules read. */
const ISSUE_FIELDS = [
  "summary",
  "status",
  "issuetype",
  "resolution",
  "parent",
  "fixVersions",
  "labels",
  "created",
  "updated",
  "issuelinks",
  "priority",
  "duedate",
  "project",
  "epicLink",
  // Jira Cloud exposes the epic link as a custom field; the named field is
  // read as well, so a project that uses either one is covered.
  "customfield_10014",
].join(",");

/** The number of issues one search page may return. */
const PAGE_SIZE = 100;

/** The largest number of pages one listing may read. */
const MAX_PAGES = 50;

/** The default cap on the issues one listing may return. */
export const DEFAULT_MAX_ISSUES = 2000;

/**
 * The search endpoints.
 *
 * The current endpoint pages by cursor (`nextPageToken`), the earlier one by
 * offset (`startAt`). The current endpoint is tried first; a site that does
 * not know it answers 404, and a site that has retired it answers 410. The
 * endpoint that worked is remembered, so only the first page costs a second
 * request.
 */
const CURSOR_SEARCH_PATH = "/rest/api/3/search/jql";
const OFFSET_SEARCH_PATH = "/rest/api/3/search";

/**
 * Normalize a configured base URL.
 *
 * A trailing slash is removed and a `/rest/api/3` suffix is dropped, so both
 * `https://example.atlassian.net` and `https://example.atlassian.net/rest/api/3`
 * address the same site.
 */
export function normalizeBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim();
  url = url.replace(/\/+$/, "");
  url = url.replace(/\/rest\/api\/3$/i, "");
  return url;
}

/**
 * Build the JQL for a project listing.
 *
 * The project key is quoted, so a key with a dash needs no escaping.
 */
export function buildProjectJql(projectKey: string, extra?: string): string {
  const project = `project = "${projectKey.replace(/"/g, "")}"`;
  const filter = extra?.trim();
  return filter ? `${project} AND (${filter})` : project;
}

/** Whether a status means the site does not know the endpoint. */
function isUnknownEndpoint(error: unknown): boolean {
  return (
    error instanceof JiraError && (error.status === 404 || error.status === 410)
  );
}

export class JiraClient {
  readonly baseUrl: string;
  private readonly email: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxIssues: number;
  /** The search endpoint that worked, remembered after the first page. */
  private searchPath?: string;

  constructor(options: JiraClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.email = options.email;
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxIssues = options.maxIssues ?? DEFAULT_MAX_ISSUES;
  }

  /** The authorization header. The token never leaves this method. */
  private authorization(): string {
    const encoded = Buffer.from(`${this.email}:${this.apiToken}`).toString(
      "base64",
    );
    return `Basic ${encoded}`;
  }

  /**
   * Perform one request against the Jira API.
   *
   * The failure messages name the status and the reason, never the
   * credentials: the authorization header is not part of any message.
   */
  private async request(path: string, search?: URLSearchParams): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (search !== undefined) {
      for (const [key, value] of search) {
        url.searchParams.set(key, value);
      }
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          authorization: this.authorization(),
          accept: "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new JiraError(`The request to ${url.pathname} failed: ${reason}`);
    }

    if (!response.ok) {
      throw new JiraError(
        `Jira answered ${response.status} ${response.statusText} for ${url.pathname}.`,
        response.status,
      );
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new JiraError(
        `Jira answered with a body that is not JSON for ${url.pathname}.`,
        response.status,
      );
    }
  }

  /**
   * List the issues of a project.
   *
   * The listing reads every page the site offers, up to the issue cap. When
   * the cap is reached the listing is marked as truncated, because the
   * project was then not covered completely.
   */
  async listIssues(
    projectKey: string,
    options?: { jql?: string; maxIssues?: number },
  ): Promise<IssueListing> {
    const jql = buildProjectJql(projectKey, options?.jql);
    const limit = Math.min(options?.maxIssues ?? this.maxIssues, this.maxIssues);

    const issues: Issue[] = [];
    let nextPageToken: string | undefined;
    let startAt = 0;
    /**
     * Why the listing stopped:
     * - `source`: the site said there is nothing more to read;
     * - `cap`: the issue cap was reached and more issues may exist;
     * - `pages`: the page cap was reached and more pages may exist.
     */
    let stopReason: "source" | "cap" | "pages" | undefined;

    for (let page = 0; page < MAX_PAGES && stopReason === undefined; page += 1) {
      const remaining = limit - issues.length;
      if (remaining <= 0) {
        stopReason = "cap";
        break;
      }

      const search = new URLSearchParams({
        jql,
        maxResults: String(Math.min(PAGE_SIZE, remaining)),
        fields: ISSUE_FIELDS,
      });

      const path = this.searchPath ?? CURSOR_SEARCH_PATH;
      if (path === OFFSET_SEARCH_PATH) {
        search.set("startAt", String(startAt));
      } else if (nextPageToken !== undefined) {
        search.set("nextPageToken", nextPageToken);
      }

      let payload: unknown;
      try {
        payload = await this.request(path, search);
      } catch (error) {
        if (this.searchPath !== undefined || !isUnknownEndpoint(error)) {
          throw error;
        }
        // The site does not know the current endpoint: use the earlier one
        // from here on, and try this page again against it. The page is not
        // counted twice.
        this.searchPath = OFFSET_SEARCH_PATH;
        page -= 1;
        continue;
      }
      this.searchPath = path;

      const pageIssues = normalizeIssues(
        (payload as { issues?: unknown } | undefined)?.issues,
      );
      issues.push(...pageIssues);

      const pagePayload = payload as
        | { isLast?: unknown; nextPageToken?: unknown; total?: unknown }
        | undefined;

      let sourceHasMore: boolean;
      if (path === CURSOR_SEARCH_PATH) {
        const isLast = pagePayload?.isLast === true;
        const token =
          typeof pagePayload?.nextPageToken === "string"
            ? pagePayload.nextPageToken
            : undefined;
        sourceHasMore = !isLast && token !== undefined && pageIssues.length > 0;
        nextPageToken = token;
      } else {
        const total =
          typeof pagePayload?.total === "number" ? pagePayload.total : undefined;
        const totalReached =
          total !== undefined && startAt + pageIssues.length >= total;
        sourceHasMore =
          pageIssues.length >= PAGE_SIZE && !totalReached && pageIssues.length > 0;
        startAt += pageIssues.length;
      }

      if (!sourceHasMore) {
        stopReason = "source";
        break;
      }
      if (issues.length >= limit) {
        stopReason = "cap";
        break;
      }
    }

    if (stopReason === undefined) {
      stopReason = "pages";
    }

    const kept = issues.slice(0, limit);
    return {
      issues: kept,
      truncated: stopReason !== "source",
      examined: kept.length,
    };
  }

  /** List the release versions of a project. */
  async listVersions(projectKey: string): Promise<ProjectVersion[]> {
    const payload = await this.request(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/versions`,
    );
    return normalizeVersions(payload);
  }
}
