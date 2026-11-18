#!/usr/bin/env node
/**
 * The process entry point.
 *
 * Without arguments the server speaks MCP over its standard input and output.
 * `--version`, `--help` and `--healthcheck` answer without starting the
 * server, so a host can ask the server what it is without taking over its
 * stdio.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseCliArgs, usage } from "./cli.js";
import {
  ConfigError,
  describeConfig,
  loadConfig,
  type Environment,
  type JiraConfig,
} from "./config.js";
import { JiraClient } from "./jira/client.js";
import { createJiraServer } from "./server.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

/** The status object printed by `--healthcheck`. */
export interface Healthcheck {
  name: string;
  version: string;
  node: string;
  /** Whether the server has a usable configuration. */
  configured: boolean;
  /** The configured project, when there is one. */
  projectKey?: string;
  /** The configured site, when there is one. */
  baseUrl?: string;
}

/**
 * Build the healthcheck status.
 *
 * The configuration is described without its secret: the API token is
 * reported as set or not set, never as a value.
 */
export function healthcheck(config?: JiraConfig): Healthcheck {
  const status: Healthcheck = {
    name: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    node: process.version,
    configured: config !== undefined,
  };
  if (config !== undefined) {
    return { ...status, ...describeConfig(config) };
  }
  return status;
}

/**
 * Start the MCP server on the standard input and output.
 *
 * The transport is the only thing the server writes to; diagnostics go to
 * the standard error, so they cannot corrupt the protocol stream.
 */
export async function startServer(config: JiraConfig): Promise<void> {
  const client = new JiraClient({
    baseUrl: config.baseUrl,
    email: config.email,
    apiToken: config.apiToken,
    timeoutMs: config.timeoutMs,
  });

  const server = createJiraServer({
    reader: client,
    projectKey: config.projectKey,
    staleDays: config.staleDays,
    maxDepth: config.maxDepth,
    secrets: [config.apiToken, config.email],
  });

  await server.connect(new StdioServerTransport());
}

/**
 * Run the command line and return the process exit code.
 *
 * The arguments are the ones without the node and script paths, and the
 * environment is a parameter, so the function stays testable without
 * spawning a process.
 */
export async function runCli(
  argv: readonly string[],
  env: Environment = process.env,
): Promise<number> {
  const mode = parseCliArgs(argv);

  switch (mode.kind) {
    case "version":
      process.stdout.write(`${PACKAGE_NAME} ${PACKAGE_VERSION}\n`);
      return 0;
    case "help":
      process.stdout.write(usage());
      return 0;
    case "healthcheck": {
      let config: JiraConfig | undefined;
      try {
        config = loadConfig(env);
      } catch {
        config = undefined;
      }
      process.stdout.write(`${JSON.stringify(healthcheck(config))}\n`);
      return 0;
    }
    case "run": {
      let config: JiraConfig;
      try {
        config = loadConfig(env);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        return 2;
      }
      try {
        await startServer(config);
        return 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        return 2;
      }
    }
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
  process.exitCode = await runCli(process.argv.slice(2));
}
