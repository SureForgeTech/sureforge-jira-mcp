/**
 * The Jira REST client.
 *
 * The client owns the transport: authentication, timeouts, pagination and
 * error mapping. The `fetch` implementation is injectable, so the tests
 * drive the real request-building and response-handling code against a local
 * mock instead of a live Jira.
 */
import { normalizeIssues, normalizeVersions } from "./normalize.js";
import type { Issue, ProjectVersion } from "./types.js";

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
  /** The largest number of issues one listing may return; defaults to 500. */
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
].join(",");

/** The number of issues one search page may return. */
const PAGE_SIZE = 100;

/** The largest number of pages one listing may read. */
const MAX_PAGES = 20;

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

export class JiraClient {
  readonly baseUrl: string;
  private readonly email: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxIssues: number;

  constructor(options: JiraClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.email = options.email;
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxIssues = options.maxIssues ?? 500;
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
   * The search endpoint moved during 2025: the current one is
   * `/rest/api/3/search/jql` and the earlier one is `/rest/api/3/search`.
   * The current endpoint is tried first and the earlier one is used when the
   * site answers 404, so the server works on both.
   */
  async listIssues(
    projectKey: string,
    options?: { jql?: string; maxIssues?: number },
  ): Promise<Issue[]> {
    const jql = buildProjectJql(projectKey, options?.jql);
    const limit = Math.min(options?.maxIssues ?? this.maxIssues, this.maxIssues);

    const issues: Issue[] = [];
    let startAt = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const search = new URLSearchParams({
        jql,
        maxResults: String(Math.min(PAGE_SIZE, limit - issues.length)),
        startAt: String(startAt),
        fields: ISSUE_FIELDS,
      });

      const payload = await this.searchPage(search);
      const pageIssues = normalizeIssues(
        (payload as { issues?: unknown } | undefined)?.issues,
      );
      issues.push(...pageIssues);

      if (pageIssues.length < PAGE_SIZE || issues.length >= limit) {
        break;
      }
      startAt += pageIssues.length;
    }

    return issues.slice(0, limit);
  }

  /**
   * Run one search page against the search endpoint, falling back to the
   * earlier endpoint when the site does not know the current one.
   */
  private async searchPage(search: URLSearchParams): Promise<unknown> {
    try {
      return await this.request("/rest/api/3/search/jql", search);
    } catch (error) {
      const isNotFound =
        error instanceof JiraError && error.status === 404;
      if (!isNotFound) {
        throw error;
      }
      return this.request("/rest/api/3/search", search);
    }
  }

  /** List the release versions of a project. */
  async listVersions(projectKey: string): Promise<ProjectVersion[]> {
    const payload = await this.request(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}/versions`,
    );
    return normalizeVersions(payload);
  }
}
