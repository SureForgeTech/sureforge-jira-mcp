import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

test("the package version and package.json agree", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { name: string; version: string };
  assert.equal(manifest.version, PACKAGE_VERSION);
  assert.equal(manifest.name, PACKAGE_NAME);
});

test("the package version is a semver string", () => {
  assert.match(PACKAGE_VERSION, /^\d+\.\d+\.\d+$/);
});
