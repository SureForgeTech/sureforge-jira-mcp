import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { healthcheck, runCli } from "./index.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

const COMPLETE_ENV = {
  JIRA_BASE_URL: "https://example.atlassian.net",
  JIRA_EMAIL: "reader@example.com",
  JIRA_API_TOKEN: "example-token-value",
  JIRA_PROJECT_KEY: "EXAMPLE",
};

/** Run the command line and capture what it writes. */
async function run(
  argv: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  let stdout = "";
  let stderr = "";
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    const code = await runCli(argv, env);
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

test("--version prints the package name and version", async () => {
  const result = await run(["--version"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${PACKAGE_NAME} ${PACKAGE_VERSION}\n`);
});

test("--help prints the usage text", async () => {
  const result = await run(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: sureforge-jira-mcp/);
});

test("--healthcheck reports that the server is not configured", async () => {
  const result = await run(["--healthcheck"], {});
  assert.equal(result.code, 0);
  const status = JSON.parse(result.stdout);
  assert.equal(status.configured, false);
  assert.equal(status.name, PACKAGE_NAME);
});

test("--healthcheck reports the configuration without the token", async () => {
  const result = await run(["--healthcheck"], COMPLETE_ENV);
  assert.equal(result.code, 0);
  const status = JSON.parse(result.stdout);
  assert.equal(status.configured, true);
  assert.equal(status.projectKey, "EXAMPLE");
  assert.equal(status.baseUrl, "https://example.atlassian.net");
  assert.equal(result.stdout.includes("example-token-value"), false);
});

test("an unknown flag exits with code 2 and writes to stderr", async () => {
  const result = await run(["--nope"], {});
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown argument/);
  assert.equal(result.stdout, "");
});

test("starting without a configuration exits with code 2 and names the variable", async () => {
  const result = await run([], {});
  assert.equal(result.code, 2);
  assert.match(result.stderr, /JIRA_BASE_URL/);
});

test("the healthcheck object names the package and the node version", () => {
  const status = healthcheck();
  assert.equal(status.name, PACKAGE_NAME);
  assert.equal(status.version, PACKAGE_VERSION);
  assert.match(status.node, /^v\d+\./);
  assert.equal(status.configured, false);
});

test("the built entry point starts with a node shebang", () => {
  const built = readFileSync(
    fileURLToPath(new URL("./index.js", import.meta.url)),
    "utf8",
  );
  assert.equal(built.split("\n", 1)[0], "#!/usr/bin/env node");
});

test("the command runs through a symlink, the way npm installs a bin entry", () => {
  const built = fileURLToPath(new URL("./index.js", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "sureforge-jira-mcp-"));
  const link = join(directory, "sureforge-jira-mcp");
  symlinkSync(built, link);

  try {
    const result = spawnSync(process.execPath, [link, "--version"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${PACKAGE_NAME} ${PACKAGE_VERSION}\n`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
