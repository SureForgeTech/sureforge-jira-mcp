/**
 * Turn Jira REST payloads into the normalized domain model.
 *
 * The normalizer is defensive on purpose: a project can hold issue types and
 * link directions that this server does not know, and a health report must
 * not fail because one issue carries an unexpected field. An issue without a
 * key cannot be reported on at all, so it is dropped.
 */
import type { Issue, IssueLink, ProjectVersion } from "./types.js";

/** The REST shape of the fields this server reads. */
interface RawIssue {
  id?: unknown;
  key?: unknown;
  fields?: {
    summary?: unknown;
    status?: { name?: unknown };
    issuetype?: { name?: unknown };
    resolution?: { name?: unknown } | null;
    parent?: { key?: unknown } | null;
    epicLink?: { key?: unknown } | null;
    customfield_10014?: { key?: unknown } | string | null;
    fixVersions?: Array<{ name?: unknown }>;
    labels?: unknown;
    created?: unknown;
    updated?: unknown;
    project?: { key?: unknown };
    issuelinks?: unknown;
    priority?: { name?: unknown } | null;
    duedate?: unknown;
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nameOf(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  return text((value as { name?: unknown }).name);
}

/** Read the issue links, keeping only the links that name another issue. */
function readIssueLinks(raw: unknown): IssueLink[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const links: IssueLink[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const link = entry as {
      type?: unknown;
      outwardIssue?: unknown;
      inwardIssue?: unknown;
    };
    const type = nameOf(link.type) ?? "Relates";
    const outwardKey =
      link.outwardIssue === null || typeof link.outwardIssue !== "object"
        ? undefined
        : text((link.outwardIssue as { key?: unknown }).key);
    const inwardKey =
      link.inwardIssue === null || typeof link.inwardIssue !== "object"
        ? undefined
        : text((link.inwardIssue as { key?: unknown }).key);

    if (outwardKey !== undefined) {
      links.push({ type, direction: "outward", targetKey: outwardKey });
    }
    if (inwardKey !== undefined) {
      links.push({ type, direction: "inward", targetKey: inwardKey });
    }
  }
  return links;
}

/**
 * Read the key of an epic link.
 *
 * The link is read from the named field or from the custom field Jira Cloud
 * uses. The custom field holds either an object with a key or the key
 * itself, depending on the site, and both are read.
 */
function epicLinkKey(value: unknown): string | undefined {
  if (typeof value === "string") {
    return text(value);
  }
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  return text((value as { key?: unknown }).key);
}

/**
 * Normalize one REST issue.
 *
 * Returns `undefined` for an issue without a key: without a key it cannot be
 * reported on, and guessing one would produce a finding about an issue that
 * does not exist.
 */
export function normalizeIssue(raw: unknown): Issue | undefined {
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  const issue = raw as RawIssue;
  const key = text(issue.key);
  if (key === undefined) {
    return undefined;
  }
  const fields = issue.fields ?? {};
  const fixVersions = Array.isArray(fields.fixVersions)
    ? fields.fixVersions
        .map((version) => nameOf(version))
        .filter((name): name is string => name !== undefined)
    : [];
  const labels = Array.isArray(fields.labels)
    ? fields.labels.filter((label): label is string => typeof label === "string")
    : [];
  // Jira Cloud exposes the epic link as a custom field, other installations
  // expose it under its name. Either one is read.
  const epicKey =
    epicLinkKey(fields.epicLink) ?? epicLinkKey(fields.customfield_10014);

  return {
    key,
    id: text(issue.id) ?? key,
    summary: text(fields.summary) ?? "",
    status: nameOf(fields.status) ?? "Unknown",
    issueType: nameOf(fields.issuetype) ?? "Unknown",
    ...(nameOf(fields.resolution) === undefined
      ? {}
      : { resolution: nameOf(fields.resolution) }),
    ...(text(fields.parent?.key) === undefined
      ? {}
      : { parentKey: text(fields.parent?.key) }),
    ...(epicKey === undefined ? {} : { epicKey }),
    fixVersions,
    labels,
    created: text(fields.created) ?? "",
    updated: text(fields.updated) ?? "",
    projectKey: text(fields.project?.key) ?? "",
    issueLinks: readIssueLinks(fields.issuelinks),
    ...(nameOf(fields.priority) === undefined
      ? {}
      : { priority: nameOf(fields.priority) }),
    ...(text(fields.duedate) === undefined
      ? {}
      : { dueDate: text(fields.duedate) }),
  };
}

/** Normalize a list of REST issues, dropping the ones without a key. */
export function normalizeIssues(raw: unknown): Issue[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const issues: Issue[] = [];
  for (const entry of raw) {
    const issue = normalizeIssue(entry);
    if (issue !== undefined) {
      issues.push(issue);
    }
  }
  return issues;
}

/** Normalize one REST project version. */
export function normalizeVersion(raw: unknown): ProjectVersion | undefined {
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  const version = raw as {
    name?: unknown;
    released?: unknown;
    releaseDate?: unknown;
    archived?: unknown;
  };
  const name = text(version.name);
  if (name === undefined) {
    return undefined;
  }
  return {
    name,
    released: version.released === true,
    ...(text(version.releaseDate) === undefined
      ? {}
      : { releaseDate: text(version.releaseDate) }),
    archived: version.archived === true,
  };
}

/** Normalize a list of REST project versions, dropping the ones without a name. */
export function normalizeVersions(raw: unknown): ProjectVersion[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const versions: ProjectVersion[] = [];
  for (const entry of raw) {
    const version = normalizeVersion(entry);
    if (version !== undefined) {
      versions.push(version);
    }
  }
  return versions;
}
