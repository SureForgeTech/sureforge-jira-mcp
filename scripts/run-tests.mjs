#!/usr/bin/env node
/**
 * Run the compiled test files with Node's test runner.
 *
 * The test files are listed explicitly instead of globbed:
 *
 *   - a shell glob (`dist/*.test.js`) is expanded by the shell, which is
 *     `cmd.exe` on Windows and does not expand it there;
 *   - a directory argument (`dist/`) is not expanded by Node's test runner on
 *     every supported Node version, and on Node 22 it silently runs none of
 *     the test files, so the suite would pass without testing anything.
 *
 * Listing the files here keeps the command shell-independent and keeps a
 * silent zero-test run impossible: no compiled test file is an error.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDirectory = join(repositoryRoot, "dist");

let compiled;
try {
  compiled = readdirSync(distDirectory);
} catch {
  console.error(`No build output in ${distDirectory}. Run the build first.`);
  process.exit(1);
}

const testFiles = compiled
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => join(distDirectory, name));

if (testFiles.length === 0) {
  console.error(`No compiled test files in ${distDirectory}. Run the build first.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
