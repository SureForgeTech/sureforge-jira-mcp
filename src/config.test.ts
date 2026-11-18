import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertUsableBaseUrl,
  ConfigError,
  describeConfig,
  loadConfig,
  redact,
} from "./config.js";

const completeEnv = {
  JIRA_BASE_URL: "https://example.atlassian.net",
  JIRA_EMAIL: "reader@example.com",
  JIRA_API_TOKEN: "example-token-value",
  JIRA_PROJECT_KEY: "example",
};

test("a complete environment is read into the configuration", () => {
  const config = loadConfig(completeEnv);
  assert.equal(config.baseUrl, "https://example.atlassian.net");
  assert.equal(config.email, "reader@example.com");
  assert.equal(config.apiToken, "example-token-value");
  assert.equal(config.projectKey, "EXAMPLE");
});

test("the defaults are used for the optional values", () => {
  const config = loadConfig(completeEnv);
  assert.equal(config.staleDays, 14);
  assert.equal(config.maxDepth, 5);
  assert.equal(config.timeoutMs, 15000);
});

test("the optional values are read from the environment", () => {
  const config = loadConfig({
    ...completeEnv,
    JIRA_STALE_DAYS: "30",
    JIRA_MAX_DEPTH: "3",
    JIRA_TIMEOUT_MS: "5000",
  });
  assert.equal(config.staleDays, 30);
  assert.equal(config.maxDepth, 3);
  assert.equal(config.timeoutMs, 5000);
});

test("every missing variable is named in the error", () => {
  for (const name of [
    "JIRA_BASE_URL",
    "JIRA_EMAIL",
    "JIRA_API_TOKEN",
    "JIRA_PROJECT_KEY",
  ]) {
    const env: Record<string, string | undefined> = { ...completeEnv };
    delete env[name];
    assert.throws(
      () => loadConfig(env),
      (error: unknown) =>
        error instanceof ConfigError && error.message.includes(name),
      `${name} should be named in the error`,
    );
  }
});

test("a value that is not a whole number is refused", () => {
  assert.throws(
    () => loadConfig({ ...completeEnv, JIRA_STALE_DAYS: "soon" }),
    ConfigError,
  );
  assert.throws(
    () => loadConfig({ ...completeEnv, JIRA_MAX_DEPTH: "-1" }),
    ConfigError,
  );
});

test("a threshold of zero is refused where it makes no sense", () => {
  assert.throws(
    () => loadConfig({ ...completeEnv, JIRA_MAX_DEPTH: "0" }),
    ConfigError,
  );
  assert.throws(
    () => loadConfig({ ...completeEnv, JIRA_TIMEOUT_MS: "0" }),
    ConfigError,
  );
});

test("a staleness of zero days is allowed", () => {
  assert.equal(loadConfig({ ...completeEnv, JIRA_STALE_DAYS: "0" }).staleDays, 0);
});

test("a base URL that is not a URL is refused", () => {
  assert.throws(
    () => loadConfig({ ...completeEnv, JIRA_BASE_URL: "example.atlassian.net" }),
    ConfigError,
  );
});

test("http is refused unless the host is a loopback address", () => {
  assert.throws(
    () => loadConfig({ ...completeEnv, JIRA_BASE_URL: "http://example.com" }),
    ConfigError,
  );
  assert.equal(
    loadConfig({
      ...completeEnv,
      JIRA_BASE_URL: "http://127.0.0.1:8080",
    }).baseUrl,
    "http://127.0.0.1:8080",
  );
  assert.equal(
    loadConfig({ ...completeEnv, JIRA_BASE_URL: "http://localhost:8080" })
      .baseUrl,
    "http://localhost:8080",
  );
});

test("a trailing slash is removed from the base URL", () => {
  assert.equal(
    assertUsableBaseUrl("https://example.atlassian.net/"),
    "https://example.atlassian.net",
  );
  assert.equal(
    loadConfig({
      ...completeEnv,
      JIRA_BASE_URL: "https://example.atlassian.net/",
    }).baseUrl,
    "https://example.atlassian.net",
  );
});

test("redaction removes every secret from a message", () => {
  const message = "failed with token example-token-value and mail reader@example.com";
  const redacted = redact(message, ["example-token-value", "reader@example.com"]);
  assert.equal(redacted.includes("example-token-value"), false);
  assert.equal(redacted.includes("reader@example.com"), false);
  assert.match(redacted, /\*\*\*/);
});

test("redaction ignores an empty secret", () => {
  assert.equal(redact("unchanged", ["", undefined]), "unchanged");
});

test("the described configuration never carries the token", () => {
  const described = describeConfig(loadConfig(completeEnv));
  const serialized = JSON.stringify(described);
  assert.equal(serialized.includes("example-token-value"), false);
  assert.equal(described.apiToken, "***");
  assert.equal(described.projectKey, "EXAMPLE");
});
