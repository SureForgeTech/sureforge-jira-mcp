/**
 * Command-line parsing for the server entry point.
 *
 * The parser is pure: it turns an argument list into a mode and never reads
 * the environment, the network or the file system. `index.ts` acts on the
 * result.
 */

/** The action the process should take. */
export type CliMode =
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "healthcheck" }
  | { kind: "run" }
  | { kind: "error"; message: string };

const KNOWN_FLAGS = new Set(["--version", "--help", "--healthcheck"]);

/**
 * Parse `argv` (without the node and script paths) into a mode.
 *
 * Unknown flags are refused rather than ignored: a typo in a flag must not
 * silently start the server in a mode the caller did not ask for.
 */
export function parseCliArgs(argv: readonly string[]): CliMode {
  for (const arg of argv) {
    if (!KNOWN_FLAGS.has(arg)) {
      return {
        kind: "error",
        message: `Unknown argument: ${arg}. Run with --help for usage.`,
      };
    }
  }

  // `--help` and `--version` win over the other modes, so a host that always
  // appends `--healthcheck` still gets the answer it asked for on the command
  // line. `--help` wins over `--version`: when a caller asks for help, the
  // usage text is the more useful answer.
  if (argv.includes("--help")) {
    return { kind: "help" };
  }
  if (argv.includes("--version")) {
    return { kind: "version" };
  }
  if (argv.includes("--healthcheck")) {
    return { kind: "healthcheck" };
  }
  return { kind: "run" };
}

/** The usage text printed by `--help`. */
export function usage(): string {
  return [
    "Usage: sureforge-jira-mcp [options]",
    "",
    "MCP server for Jira health.",
    "",
    "Options:",
    "  --version      print the package version and exit",
    "  --healthcheck  print a status object and exit",
    "  --help         print this help and exit",
    "",
  ].join("\n");
}
