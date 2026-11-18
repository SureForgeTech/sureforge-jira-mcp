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
 * The directories are searched recursively, because the tests of the modules
 * in `src/health/` and `src/jira/` are compiled into subdirectories of
 * `dist/` and a shallow search would leave them unrun.
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

/** Collect the test files of a directory, recursively. */
function collectTestFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectTestFiles(path));
      continue;
    }
    if (entry.name.endsWith(".test.js") || entry.name.endsWith(".test.mjs")) {
      found.push(path);
    }
  }
  return found.sort();
}

const testFiles = [];
for (const target of targets) {
  const directory = join(repositoryRoot, target);
  let entries;
  try {
    entries = collectTestFiles(directory);
  } catch {
    console.error(`No such directory: ${directory}`);
    process.exit(1);
  }
  if (entries.length === 0) {
    console.error(`No test files in ${directory}.`);
    process.exit(1);
  }
  testFiles.push(...entries);
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
