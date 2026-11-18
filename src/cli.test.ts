import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCliArgs, usage } from "./cli.js";

test("no arguments selects the run mode", () => {
  assert.deepEqual(parseCliArgs([]), { kind: "run" });
});

test("--version selects the version mode", () => {
  assert.deepEqual(parseCliArgs(["--version"]), { kind: "version" });
});

test("--help selects the help mode", () => {
  assert.deepEqual(parseCliArgs(["--help"]), { kind: "help" });
});

test("--healthcheck selects the healthcheck mode", () => {
  assert.deepEqual(parseCliArgs(["--healthcheck"]), { kind: "healthcheck" });
});

test("--version wins over --healthcheck", () => {
  assert.deepEqual(parseCliArgs(["--healthcheck", "--version"]), {
    kind: "version",
  });
});

test("--help wins over --version", () => {
  assert.deepEqual(parseCliArgs(["--version", "--help"]), { kind: "help" });
});

test("an unknown flag is refused rather than ignored", () => {
  const mode = parseCliArgs(["--unknown"]);
  assert.equal(mode.kind, "error");
  if (mode.kind === "error") {
    assert.match(mode.message, /Unknown argument: --unknown/);
  }
});

test("an unknown flag wins over a known one", () => {
  assert.equal(parseCliArgs(["--version", "--typo"]).kind, "error");
});

test("the usage text names every supported flag", () => {
  const text = usage();
  for (const flag of ["--version", "--help", "--healthcheck"]) {
    assert.ok(text.includes(flag), `usage should mention ${flag}`);
  }
});
