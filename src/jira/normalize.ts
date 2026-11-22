/**
 * Turn Jira REST payloads into the normalized domain model.
 *
 * The normalizer is defensive on purpose: a project can hold issue types and
 * link directions that this server does not know, and a health report must
 * not fail because one issue carries an unexpected field. An issue without a
 * key cannot be reported on at all, so it is dropped.
 */
import type {
  InstanceHealthCheck,
  Issue,
  IssueLink,
  ProjectSummary,
  ProjectVersion,
  ServerInfo,
  StatusCategory,
} from "./types.js";

/** The REST shape of the fields this server reads. */
interface RawIssue {
  id?: unknown;
  key?: unknown;
  fields?: {
    summary?: unknown;
    status?: { name?: unknown; statusCategory?: { key?: unknown } | null };
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
    description?: unknown;
    assignee?: {
      displayName?: unknown;
      name?: unknown;
      key?: unknown;
      accountId?: unknown;
    } | null;
  };
}

/**
 * The shape of an issue key: a project key and a number.
 *
 * The health tools report on issues of one project, so a relation is only
 * read from a value that names an issue.
 */
const ISSUE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

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
 * The epic key a field holds, when it names an issue.
 *
 * The value of an epic link field is the key of the epic. A value that
 * does not have the shape of an issue key - a team name, a label - is not
 * a relation, and reading it as one would report an epic that does not
 * exist.
 */
function epicLinkKey(value: unknown): string | undefined {
  const candidate =
    typeof value === "string"
      ? text(value)
      : value === null || typeof value !== "object"
        ? undefined
        : text((value as { key?: unknown }).key);
  if (candidate === undefined) {
    return undefined;
  }
  // The value has to name an issue - a project key and a number - to be a
  // relation. A field that holds free text is not one, and reading it as
  // one would report an epic that does not exist.
  if (!ISSUE_KEY_PATTERN.test(candidate)) {
    return undefined;
  }
  return candidate;
}

/**
 * Whether a field holds a value that cannot be an epic relation.
 *
 * A field that holds free text - a team name, say - is not an epic link,
 * so the epic relation was not read even though the site answered. The
 * listing says so, and the findings that depend on it are hedged.
 */
export function hasUnusableEpicValue(
  fields: unknown,
  epicLinkField?: string,
): boolean {
  if (fields === null || typeof fields !== "object") {
    return false;
  }
  const record = fields as Record<string, unknown>;
  const sources = [
    epicLinkField === undefined ? undefined : record[epicLinkField],
    record.epicLink,
    record.customfield_10014,
  ];
  return sources.some((source) => {
    if (source === undefined || source === null) {
      return false;
    }
    if (typeof source === "string") {
      // A value that is there but is not an issue key: a number, a
      // boolean, a list, a field that holds free text.
      return source.length > 0 && !ISSUE_KEY_PATTERN.test(source);
    }
    if (typeof source === "object") {
      const key = (source as { key?: unknown }).key;
      if (key === undefined) {
        // A value that is not an issue key at all - a select list, say.
        return Object.keys(source as object).length > 0;
      }
      // A key that is not a string cannot be read as an issue key.
      return typeof key !== "string" || !ISSUE_KEY_PATTERN.test(key);
    }
    // A number or a boolean is never an issue key.
    return true;
  });
}

/**
 * Normalize one REST issue.
 *
 * The Epic Link field is read from the field the caller names first, because
 * an operator who names a field means it, then from the field the site calls
 * `epicLink`, then from the field with the usual id.
 *
 * Returns `undefined` for an issue without a key: without a key it cannot be
 * reported on, and guessing one would produce a finding about an issue that
 * does not exist.
 */
export function normalizeIssue(
  raw: unknown,
  epicLinkField?: string,
): Issue | undefined {
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
  // expose it under its name. The id is site-specific, so the field the
  // caller names is read first: an operator who names a field means it.
  //
  // A value only names an epic when it has the shape of an issue key: a
  // field that holds free text - a team name, say - would otherwise put a
  // relation into the findings that no issue has.
  const epicKey =
    (epicLinkField === undefined
      ? undefined
      : epicLinkKey((fields as Record<string, unknown>)[epicLinkField])) ??
    epicLinkKey(fields.epicLink) ??
    epicLinkKey(fields.customfield_10014);

  return {
    key,
    id: text(issue.id) ?? key,
    summary: text(fields.summary) ?? "",
    status: nameOf(fields.status) ?? "Unknown",
    statusCategory: statusCategoryOf(fields.status),
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
    ...(assigneeName(fields.assignee) === undefined
      ? {}
      : { assignee: assigneeName(fields.assignee) }),
    descriptionPresent: hasContent(fields.description),
  };
}

/**
 * The category Jira groups a status in.
 *
 * The three categories are the ones Jira uses for every status; a site that
 * reports none of them leaves the category `indeterminate`, so a rule that
 * needs to know whether work is open cannot be told apart from a status it
 * does not know.
 */
function statusCategoryOf(status: unknown): StatusCategory {
  const key = text(
    status !== null && typeof status === "object"
      ? (status as { statusCategory?: { key?: unknown } | null }).statusCategory?.key
      : undefined,
  );
  if (key === "new" || key === "done") {
    return key;
  }
  return "indeterminate";
}

/** The name of the account an issue is assigned to. */
function assigneeName(assignee: unknown): string | undefined {
  if (assignee === null || typeof assignee !== "object") {
    return undefined;
  }
  const account = assignee as {
    displayName?: unknown;
    name?: unknown;
    key?: unknown;
  };
  return (
    text(account.displayName) ?? text(account.name) ?? text(account.key)
  );
}

/**
 * Whether a field carries content.
 *
 * A description is a document on Jira Cloud and a string on Jira Server. An
 * empty document and an empty string are both no description.
 */
export function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    const content = (value as { content?: unknown }).content;
    if (Array.isArray(content)) {
      return content.length > 0;
    }
    return Object.keys(value).length > 0;
  }
  return true;
}

/** Normalize a list of REST issues, dropping the ones without a key. */
export function normalizeIssues(
  raw: unknown,
  epicLinkField?: string,
): Issue[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const issues: Issue[] = [];
  for (const entry of raw) {
    const issue = normalizeIssue(entry, epicLinkField);
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

/**
 * Normalize what the instance reports about itself.
 *
 * Every field is optional: a site may answer with less than the documented
 * shape, and the report has to say what it knows rather than fail.
 */
export function normalizeServerInfo(raw: unknown): ServerInfo {
  if (raw === null || typeof raw !== "object") {
    return { healthChecks: [], healthChecksReported: false };
  }
  const info = raw as {
    baseUrl?: unknown;
    version?: unknown;
    versionNumbers?: unknown;
    deploymentType?: unknown;
    buildNumber?: unknown;
    serverTitle?: unknown;
    healthChecks?: unknown;
  };

  const versionNumbers = Array.isArray(info.versionNumbers)
    ? info.versionNumbers.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value),
      )
    : undefined;

  const healthChecks = normalizeHealthChecks(info.healthChecks);

  return {
    ...(text(info.baseUrl) === undefined ? {} : { baseUrl: text(info.baseUrl) }),
    ...(text(info.version) === undefined ? {} : { version: text(info.version) }),
    ...(versionNumbers === undefined ? {} : { versionNumbers }),
    ...(text(info.deploymentType) === undefined
      ? {}
      : { deploymentType: text(info.deploymentType) }),
    ...(typeof info.buildNumber === "number" && Number.isFinite(info.buildNumber)
      ? { buildNumber: info.buildNumber }
      : {}),
    ...(text(info.serverTitle) === undefined
      ? {}
      : { serverTitle: text(info.serverTitle) }),
    healthChecks,
    // The flag means the instance reported health check results. Jira Cloud
    // answers with an empty list, because the field is deprecated there, so
    // an empty list is no evidence that the instance was checked.
    healthChecksReported: healthChecks.length > 0,
  };
}

/** Normalize the health checks the instance reports about itself. */
export function normalizeHealthChecks(raw: unknown): InstanceHealthCheck[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const checks: InstanceHealthCheck[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const check = entry as { name?: unknown; description?: unknown; passed?: unknown };
    const name = text(check.name);
    if (name === undefined) {
      continue;
    }
    checks.push({
      name,
      ...(text(check.description) === undefined
        ? {}
        : { description: text(check.description) }),
      // A result the instance did not state is not a failed check.
      ...(typeof check.passed === "boolean" ? { passed: check.passed } : {}),
    });
  }
  return checks;
}

/**
 * Normalize the part of a project the health report needs.
 *
 * Returns `undefined` for a payload that names no project, so the caller can
 * tell "the project was not found" from "the project has no name".
 */
export function normalizeProject(raw: unknown): ProjectSummary | undefined {
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  const project = raw as {
    key?: unknown;
    name?: unknown;
    projectTypeKey?: unknown;
    issueTypes?: unknown;
  };
  const key = text(project.key);
  if (key === undefined) {
    return undefined;
  }
  const issueTypes = Array.isArray(project.issueTypes)
    ? project.issueTypes
        .map((issueType) =>
          issueType !== null && typeof issueType === "object"
            ? text((issueType as { name?: unknown }).name)
            : undefined,
        )
        .filter((name): name is string => name !== undefined)
    : [];
  return {
    key,
    ...(text(project.name) === undefined ? {} : { name: text(project.name) }),
    ...(text(project.projectTypeKey) === undefined
      ? {}
      : { projectTypeKey: text(project.projectTypeKey) }),
    issueTypes,
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
