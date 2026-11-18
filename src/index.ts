#!/usr/bin/env node
/**
 * The process entry point.
 *
 * Task one of the build-out is the toolchain and the declared validation, so
 * the entry point only reports identity and health. The MCP stdio server is
 * wired up in the next change; until then `run` behaves like a healthcheck
 * instead of blocking on stdin.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCliArgs, usage } from "./cli.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

/** The status object printed by `--healthcheck`. */
export interface Healthcheck {
  name: string;
  version: string;
  node: string;
}

/** Build the healthcheck status object. */
export function healthcheck(): Healthcheck {
  return {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    node: process.version,
  };
}

/**
 * Run the entry point and return the process exit code.
 *
 * `argv` is the argument list without the node and script paths, so the
 * function stays testable without spawning a process.
 */
export function main(argv: readonly string[]): number {
  const mode = parseCliArgs(argv);

  switch (mode.kind) {
    case "version":
      process.stdout.write(`${PACKAGE_NAME} ${PACKAGE_VERSION}\n`);
      return 0;
    case "help":
      process.stdout.write(usage());
      return 0;
    case "healthcheck":
    case "run":
      process.stdout.write(`${JSON.stringify(healthcheck())}\n`);
      return 0;
    case "error":
      process.stderr.write(`${mode.message}\n`);
      return 2;
  }
}

/**
 * Whether this module is the process entry point.
 *
 * npm installs a `bin` entry as a symlink to the built file, so the path in
 * `process.argv[1]` and the module's own path are different names for the
 * same file. Both sides are resolved to their real paths before they are
 * compared; otherwise the entry point never runs through the installed
 * command and the process exits silently.
 */
function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (script === undefined) {
    return false;
  }
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = main(process.argv.slice(2));
}
