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
  /**
   * The id of the Epic Link field, for example `customfield_10014`.
   *
   * The id is site-specific: a project in the classic layout or on Jira
   * Server uses another one. When the site refuses the field, the listing
   * is read without it rather than failing.
   */
  readonly epicLinkField?: string;
}

/** The default id of the Epic Link field. */
export const DEFAULT_EPIC_LINK_FIELD = "customfield_10014";

/** The fields the health rules read. */
const BASE_ISSUE_FIELDS = [
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
];

/**
 * The fields one request asks for.
 *
 * The Epic Link field is asked for by its id, because no installation names
 * it `epicLink` and a site may refuse a request that names a field it does
 * not know. An id that names a field the server always asks for is ignored:
 * it cannot be the epic link, and reading it would put a wrong value into
 * the rules.
 */
export function issueFields(epicLinkField?: string): string {
  const field = epicLinkField?.trim();
  if (
    field === undefined ||
    field === "" ||
    BASE_ISSUE_FIELDS.includes(field)
  ) {
    return BASE_ISSUE_FIELDS.join(",");
  }
  return [...BASE_ISSUE_FIELDS, field].join(",");
}

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

/** Whether a status means the site refused the request itself. */
function isRefusedRequest(error: unknown): boolean {
  return error instanceof JiraError && error.status === 400;
}

export class JiraClient {
  readonly baseUrl: string;
  private readonly email: string;
  private readonly apiToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxIssues: number;
  private readonly epicLinkField?: string;
  /** The search endpoint that worked, remembered after the first page. */
  private searchPath?: string;

  constructor(options: JiraClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.email = options.email;
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxIssues = options.maxIssues ?? DEFAULT_MAX_ISSUES;
    this.epicLinkField = options.epicLinkField ?? DEFAULT_EPIC_LINK_FIELD;
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
    const seenKeys = new Set<string>();
    let dropped = 0;
    // Whether this listing was refused the Epic Link field. It is per
    // listing: one refused request must not soften every later listing.
    let epicLinkFieldRefused = false;
    let nextPageToken: string | undefined;
    let startAt = 0;
    /**
     * Why the listing stopped:
     * - `source`: the site said there is nothing more to read;
     * - `cap`: the issue cap was reached and more issues may exist;
     * - `pages`: the page cap was reached and more pages may exist;
     * - `unreadable`: the site said there was more but gave no way to
     *   read it, or it repeated a page, so the listing is incomplete.
     */
    let stopReason:
      | "source"
      | "cap"
      | "pages"
      | "unreadable"
      | undefined;

    for (let page = 0; page < MAX_PAGES && stopReason === undefined; page += 1) {
      const remaining = limit - issues.length;
      if (remaining <= 0) {
        stopReason = "cap";
        break;
      }

      const requested = Math.min(PAGE_SIZE, remaining);
      const search = new URLSearchParams({
        jql,
        maxResults: String(requested),
        fields: issueFields(
          epicLinkFieldRefused ? undefined : this.epicLinkField,
        ),
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
        if (
          isRefusedRequest(error) &&
          !epicLinkFieldRefused &&
          this.epicLinkField !== undefined
        ) {
          // The site refused the request, most likely because of the Epic
          // Link field. Read the listing without it rather than failing:
          // the epic link is then not known, and the listing says so.
          epicLinkFieldRefused = true;
          page -= 1;
          continue;
        }
        if (this.searchPath !== undefined) {
          throw error;
        }
        if (isUnknownEndpoint(error)) {
          // The site does not know the current endpoint: use the earlier
          // one from here on, and try this page again against it. The page
          // is not counted twice.
          this.searchPath = OFFSET_SEARCH_PATH;
          page -= 1;
          continue;
        }
        throw error;
      }
      this.searchPath = path;

      const rawIssues = (payload as { issues?: unknown } | undefined)?.issues;
      const rawCount = Array.isArray(rawIssues) ? rawIssues.length : 0;
      const pageIssues = normalizeIssues(
        rawIssues,
        epicLinkFieldRefused ? undefined : this.epicLinkField,
      );
      dropped += rawCount - pageIssues.length;

      const fresh = pageIssues.filter((issue) => !seenKeys.has(issue.key));
      for (const issue of fresh) {
        seenKeys.add(issue.key);
      }
      issues.push(...fresh);

      const pagePayload = payload as
        | { isLast?: unknown; nextPageToken?: unknown; total?: unknown }
        | undefined;

      let sourceHasMore: boolean;
      let unreadable = false;
      if (path === CURSOR_SEARCH_PATH) {
        const isLast = pagePayload?.isLast === true;
        const token =
          typeof pagePayload?.nextPageToken === "string"
            ? pagePayload.nextPageToken
            : undefined;
        if (isLast) {
          sourceHasMore = false;
        } else if (token === undefined) {
          // The site says there is more but gives no way to read it.
          sourceHasMore = false;
          unreadable = true;
        } else if (rawCount === 0) {
          // The site says there is more, gives a way to read it, and then
          // hands over an empty page. The listing is incomplete.
          sourceHasMore = false;
          unreadable = true;
        } else if (pageIssues.length > 0 && fresh.length === 0) {
          // The site repeats a page: every issue on it was read before.
          // Reading it again would only repeat the same issues.
          sourceHasMore = false;
          unreadable = true;
        } else {
          sourceHasMore = true;
          nextPageToken = token;
        }
      } else {
        const total =
          typeof pagePayload?.total === "number" ? pagePayload.total : undefined;
        if (total !== undefined) {
          // The site states how many issues the project holds, so the
          // listing is complete as soon as that many were read.
          const more = startAt + rawCount < total;
          if (rawCount === 0) {
            sourceHasMore = false;
            if (more) {
              // The site says the project holds more issues and hands over
              // an empty page, so the listing is incomplete.
              unreadable = true;
            }
          } else if (pageIssues.length > 0 && fresh.length === 0) {
            // The site repeats a page.
            sourceHasMore = false;
            unreadable = true;
          } else {
            sourceHasMore = more;
          }
        } else {
          // Without a total, the listing ends when the site returns fewer
          // issues than were asked for. A site that caps the page size
          // answers fewer issues than were asked for and still has more, so
          // the listing cannot be called complete.
          if (rawCount >= requested) {
            sourceHasMore = true;
          } else {
            sourceHasMore = false;
            unreadable = true;
          }
        }
        // The offset moves by the number of issues the site returned, not by
        // the number that could be normalized, so the next window does not
        // overlap this one.
        startAt += rawCount;
      }

      if (unreadable) {
        stopReason = "unreadable";
        break;
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
    // The issues the cap cut off are lost, so they count as dropped.
    dropped += issues.length - kept.length;
    return {
      issues: kept,
      // An issue without a key is left out of the listing, and such an issue
      // may point at another one. The listing is therefore incomplete when
      // any issue was left out.
      truncated: stopReason !== "source" || dropped > 0,
      examined: kept.length,
      dropped,
      // A site that refused the Epic Link field was read without it, so the
      // epic relation is not known and the findings that depend on the
      // absence of an epic cannot be stated as fact.
      epicLinkKnown: !epicLinkFieldRefused,
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
