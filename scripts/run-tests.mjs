#!/usr/bin/env node
/**
 * Run the compiled test files with Node's test runner.
 *
 * The test files are listed explicitly instead of globbed:
 *
 *   - a shell glob (`dist/*.test.js`) is expanded by the shell, which is
 *     `cmd.exe` on Windows and does not expand it there;
 *   - a directory argument (`node --test dist/`) is not expanded by Node's
 *     test runner on every supported Node version, and on Node 22 it silently
 *     runs none of the test files, so the suite would pass without testing
 *     anything.
 *
 * Listing the files here keeps the command shell-independent and keeps a
 * silent zero-test run impossible: a directory without a test file is an
 * error.
 *
 * Usage: node scripts/run-tests.mjs [directory ...]
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const directories = process.argv.slice(2);
const targets = directories.length > 0 ? directories : ["dist"];

const testFiles = [];
for (const target of targets) {
  const directory = join(repositoryRoot, target);
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    console.error(`No such directory: ${directory}`);
    process.exit(1);
  }
  const found = entries
    .filter((name) => name.endsWith(".test.js") || name.endsWith(".test.mjs"))
    .sort()
    .map((name) => join(directory, name));
  if (found.length === 0) {
    console.error(`No test files in ${directory}.`);
    process.exit(1);
  }
  testFiles.push(...found);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
