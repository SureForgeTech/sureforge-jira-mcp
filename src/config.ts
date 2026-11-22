/**
 * Configuration and credential handling.
 *
 * The configuration comes from the environment only. Nothing here ever
 * prints a token: the values are read once, kept in memory, and every
 * message that could carry one goes through `redact`.
 */

/** Remove trailing path separators in one backwards scan. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}

/** A configuration value that cannot be used. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** The configuration the server runs with. */
export interface JiraConfig {
  /** The Jira site, for example `https://example.atlassian.net`. */
  readonly baseUrl: string;
  /** The account email used for basic authentication. */
  readonly email: string;
  /** The API token used for basic authentication. */
  readonly apiToken: string;
  /** The project the health report covers. */
  readonly projectKey: string;
  /** A blocker that has not moved for this many days is stale. */
  readonly staleDays: number;
  /** A hierarchy deeper than this many levels is reported. */
  readonly maxDepth: number;
  /** Days without an update that make work in progress stale. */
  readonly staleInProgressDays: number;
  /** The request timeout in milliseconds. */
  readonly timeoutMs: number;
  /**
   * The id of the Epic Link field, for example `customfield_10014`.
   *
   * The id is site-specific. It is asked for by default, and a site that
   * refuses the request is read without the field rather than failing.
   */
  readonly epicLinkField?: string;
}

/** The environment the configuration is read from. */
export type Environment = Record<string, string | undefined>;

/** The names of the environment variables the server reads. */
export const CONFIG_VARIABLES = [
  "JIRA_BASE_URL",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_PROJECT_KEY",
  "JIRA_STALE_DAYS",
  "JIRA_MAX_DEPTH",
  "JIRA_STALE_IN_PROGRESS_DAYS",
  "JIRA_TIMEOUT_MS",
  "JIRA_EPIC_LINK_FIELD",
] as const;

const DEFAULT_STALE_DAYS = 14;
const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_STALE_IN_PROGRESS_DAYS = 30;
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Check that a base URL is safe to talk to.
 *
 * Only `https` is allowed, with one exception: `http` is accepted for
 * loopback addresses, so a mock server on the local machine can be used in a
 * test without handing out a certificate.
 */
export function assertUsableBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ConfigError(
      "JIRA_BASE_URL is not a URL. Use the site address, for example https://example.atlassian.net.",
    );
  }

  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ConfigError(
      `JIRA_BASE_URL must use https, or http for a loopback address. "${url.protocol}//" is not accepted.`,
    );
  }

  return stripTrailingSlashes(baseUrl);
}
function readInteger(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new ConfigError(
      `${name} must be a whole number that is not below ${minimum}, not "${raw}".`,
    );
  }
  return value;
}

function readRequired(
  env: Environment,
  name: string,
  hint: string,
): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new ConfigError(`${name} is not set. ${hint}`);
  }
  return value;
}

/**
 * Read the id of the Epic Link field.
 *
 * The id has to look like a field id. A value that is not one is refused
 * rather than sent to the site, because a wrong value would put a wrong
 * relation into the findings.
 */
function readEpicLinkField(env: Environment): string | undefined {
  const raw = env.JIRA_EPIC_LINK_FIELD?.trim();
  if (raw === undefined || raw === "") {
    return undefined;
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) {
    throw new ConfigError(
      `JIRA_EPIC_LINK_FIELD must look like a field id, for example customfield_10014, not "${raw}".`,
    );
  }
  return raw;
}

/**
 * Read the configuration from the environment.
 *
 * Throws a `ConfigError` with a message that names the variable and how to
 * fix it, and never a message that carries a value.
 */
export function loadConfig(env: Environment = process.env): JiraConfig {
  const baseUrl = assertUsableBaseUrl(
    readRequired(
      env,
      "JIRA_BASE_URL",
      "Set it to the Jira site address, for example https://example.atlassian.net.",
    ),
  );
  const email = readRequired(
    env,
    "JIRA_EMAIL",
    "Set it to the email address of the account that reads the project.",
  );
  const apiToken = readRequired(
    env,
    "JIRA_API_TOKEN",
    "Set it to the API token of that account. Never commit it.",
  );
  const projectKey = readRequired(
    env,
    "JIRA_PROJECT_KEY",
    "Set it to the key of the project to report on, for example EXAMPLE.",
  );

  return {
    baseUrl,
    email,
    apiToken,
    projectKey: projectKey.toUpperCase(),
    staleDays: readInteger(env.JIRA_STALE_DAYS, "JIRA_STALE_DAYS", DEFAULT_STALE_DAYS, 0),
    maxDepth: readInteger(env.JIRA_MAX_DEPTH, "JIRA_MAX_DEPTH", DEFAULT_MAX_DEPTH, 1),
    staleInProgressDays: readInteger(
      env.JIRA_STALE_IN_PROGRESS_DAYS,
      "JIRA_STALE_IN_PROGRESS_DAYS",
      DEFAULT_STALE_IN_PROGRESS_DAYS,
      1,
    ),
    timeoutMs: readInteger(
      env.JIRA_TIMEOUT_MS,
      "JIRA_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
      1,
    ),
    ...(readEpicLinkField(env) === undefined
      ? {}
      : { epicLinkField: readEpicLinkField(env) }),
  };
}

/**
 * Replace secrets in a string with a placeholder.
 *
 * Every message that can carry a token goes through this, so a token cannot
 * reach a log, an error or a tool result.
 */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let result = text;
  for (const secret of secrets) {
    if (secret === undefined || secret.length === 0) {
      continue;
    }
    result = result.split(secret).join("***");
  }
  return result;
}

/** The configuration with its secrets removed, safe to print. */
export function describeConfig(config: JiraConfig): Record<string, unknown> {
  return {
    baseUrl: config.baseUrl,
    email: config.email,
    apiToken: "***",
    projectKey: config.projectKey,
    staleDays: config.staleDays,
    maxDepth: config.maxDepth,
    staleInProgressDays: config.staleInProgressDays,
    timeoutMs: config.timeoutMs,
    ...(config.epicLinkField === undefined
      ? {}
      : { epicLinkField: config.epicLinkField }),
  };
}
