/**
 * The process entry point.
 *
 * Task one of the build-out is the toolchain and the declared validation, so
 * the entry point only reports identity and health. The MCP stdio server is
 * wired up in the next change; until then `run` behaves like a healthcheck
 * instead of blocking on stdin.
 */
import { pathToFileURL } from "node:url";
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

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
