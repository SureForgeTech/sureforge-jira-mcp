import assert from "node:assert/strict";
import { test } from "node:test";
import { healthcheck, main } from "./index.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

/** Run `main` with the given arguments and capture what it writes. */
function run(
  argv: string[],
): { code: number; stdout: string; stderr: string } {
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
    const code = main(argv);
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

test("--version prints the package name and version", () => {
  const result = run(["--version"]);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${PACKAGE_NAME} ${PACKAGE_VERSION}\n`);
});

test("--help prints the usage text", () => {
  const result = run(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: sureforge-jira-mcp/);
});

test("no arguments prints the healthcheck and exits cleanly", () => {
  const result = run([]);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), healthcheck());
});

test("--healthcheck prints the same status object as the default mode", () => {
  const explicit = run(["--healthcheck"]);
  const implicit = run([]);
  assert.equal(explicit.code, 0);
  assert.equal(explicit.stdout, implicit.stdout);
});

test("an unknown flag exits with code 2 and writes to stderr", () => {
  const result = run(["--nope"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Unknown argument/);
  assert.equal(result.stdout, "");
});

test("the healthcheck object names the package and the node version", () => {
  const status = healthcheck();
  assert.equal(status.name, PACKAGE_NAME);
  assert.equal(status.version, PACKAGE_VERSION);
  assert.match(status.node, /^v\d+\./);
});
