/**
 * The MCP server.
 *
 * The server publishes seven read-only tools over the health rules: one per
 * problem the product names, plus the aggregate summary. Every tool reads
 * the project through the client and returns findings as JSON.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { redact } from "./config.js";
import { findHygieneProblems } from "./health/hygiene.js";
import { checkInstallation } from "./health/install.js";
import {
  findBrokenHierarchies,
  findMissingReleaseVersions,
  findOrphanedIssues,
  findStaleBlockers,
} from "./health/rules.js";
import { sortFindings, summarizeHealth } from "./health/summary.js";
import type {
  Finding,
  Issue,
  IssueListing,
  ProjectSummary,
  ProjectVersion,
  ServerInfo,
} from "./jira/types.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";

/** The part of the Jira client the server uses. */
export interface JiraReader {
  listIssues(
    projectKey: string,
    options?: { jql?: string; maxIssues?: number; extraFields?: string[] },
  ): Promise<IssueListing>;
  listVersions(projectKey: string): Promise<ProjectVersion[]>;
  /** What the instance reports about itself. */
  getServerInfo(): Promise<ServerInfo>;
  /** The part of a project the installation report needs. */
  getProject(projectKey: string): Promise<ProjectSummary>;
}

/** How the server is set up. */
export interface HealthServerOptions {
  /** The client that reads Jira. */
  readonly reader: JiraReader;
  /** The project the tools report on. */
  readonly projectKey: string;
  /** A blocker that has not moved for this many days is stale. */
  readonly staleDays: number;
  /** A hierarchy deeper than this many levels is reported. */
  readonly maxDepth: number;
  /** Days without an update that make work in progress stale. */
  readonly staleInProgressDays: number;
  /** The clock the staleness rule measures against. */
  readonly now?: () => Date;
  /** The secrets that must never appear in a message. */
  readonly secrets?: readonly (string | undefined)[];
}

/** The tools the server publishes. */
export const TOOL_NAMES = [
  "jira_find_orphaned_issues",
  "jira_find_missing_release_versions",
  "jira_find_stale_blockers",
  "jira_find_broken_hierarchies",
  "jira_health_summary",
  "jira_check_installation",
  "jira_find_issue_hygiene_problems",
] as const;

/** One tool name. */
export type ToolName = (typeof TOOL_NAMES)[number];

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

function toolResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(error: unknown, secrets: readonly (string | undefined)[]) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: redact(message, secrets) }, null, 2),
      },
    ],
  };
}

/** The input every tool accepts. */
const toolInput = z.object({
  projectKey: z
    .string()
    .optional()
    .describe("The project to report on. Defaults to the configured project."),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("The largest number of findings to return. Defaults to 100."),
});

/**
 * Create the server.
 *
 * The client is a parameter, so the tools can be driven against a mock in
 * the tests and against Jira in production.
 */
export function createJiraServer(options: HealthServerOptions): McpServer {
  const secrets = options.secrets ?? [];
  const now = options.now ?? (() => new Date());

  const server = new McpServer(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    {
      instructions:
        "Read the Jira project first, then act on the findings. The tools only read: they never change an issue. " +
        "Findings are ordered worst first. Every value in a finding is invented example data unless it names a real issue key.",
    },
  );

  const projectOf = (args: { projectKey?: string }): string =>
    args.projectKey?.trim().toUpperCase() || options.projectKey;

  /**
   * Read the issues of a project.
   *
   * The listing says whether it covers the whole project, and the rules that
   * depend on the absence of an issue follow that flag.
   *
   * The description and the assignee are only asked for when a rule reads
   * them: the other tools would otherwise download the text of every
   * description of every issue for nothing.
   */
  const loadIssues = async (
    projectKey: string,
    extra?: { hygiene?: boolean },
  ): Promise<{
    issues: Issue[];
    listingComplete: boolean;
    epicLinkKnown: boolean;
    listing: IssueListing;
  }> => {
    const listing = await options.reader.listIssues(projectKey, {
      ...(extra?.hygiene === true
        ? { extraFields: ["description", "assignee"] }
        : {}),
    });
    return {
      issues: [...listing.issues],
      // Two different unknowns, kept apart: a listing may be missing
      // issues, and the epic relation may not have been read. A rule that
      // depends on the absence of an issue needs the first; a rule that
      // depends on the epic relation needs the second. Folding them into
      // one flag made a missing parent look like an unproven absence, and
      // downgraded it from high severity.
      listingComplete: !listing.truncated,
      epicLinkKnown: listing.epicLinkKnown,
      listing,
    };
  };

  /** Read the release versions of a project. */
  const loadVersions = async (projectKey: string): Promise<ProjectVersion[]> =>
    options.reader.listVersions(projectKey);

  /** The part of a tool result that describes the listing it is based on. */
  const listingReport = (
    issues: readonly Issue[],
    listing: IssueListing,
  ): Record<string, unknown> => ({
    issuesExamined: issues.length,
    ...(listing.truncated ? { truncated: true } : {}),
    ...(listing.dropped > 0 ? { issuesDropped: listing.dropped } : {}),
    ...(listing.epicLinkKnown ? {} : { epicLinkKnown: false }),
  });

  /**
   * The findings of a tool, worst first.
   *
   * The order is applied before the limit, so a limit keeps the findings
   * that matter and not the ones that happen to come first.
   */
  const ranked = (
    findings: readonly Finding[],
    limit: number,
  ): Finding[] => sortFindings(findings).slice(0, limit);

  const register = <S extends z.ZodRawShape>(
    name: ToolName,
    config: {
      title: string;
      description: string;
      inputSchema: z.ZodObject<S>;
    },
    handler: (args: z.output<z.ZodObject<S>>) => Promise<unknown>,
  ): void => {
    server.registerTool<AnySchema, z.ZodObject<S>>(
      name,
      { ...config, annotations: readAnnotations },
      async (args) => {
        try {
          return toolResult(await handler(args));
        } catch (error) {
          return errorResult(error, secrets);
        }
      },
    );
  };

  register(
    "jira_find_orphaned_issues",
    {
      title: "Find orphaned issues",
      description:
        "Find the open issues that stand on their own: no parent, no epic, no link to another issue, and nothing pointing at them.",
      inputSchema: toolInput,
    },
    async (args) => {
      const projectKey = projectOf(args);
      const { issues, listingComplete, epicLinkKnown, listing } =
        await loadIssues(projectKey);
      const findings = findOrphanedIssues(issues, {
        listingComplete,
        epicLinkKnown,
      });
      return {
        projectKey,
        count: findings.length,
        ...listingReport(issues, listing),
        findings: ranked(findings, args.limit ?? 100),
      };
    },
  );

  register(
    "jira_find_missing_release_versions",
    {
      title: "Find missing release versions",
      description:
        "Find the issues whose release version is missing or wrong: an issue names a version the project does not have, or an issue ships in a release while its parent carries no version.",
      inputSchema: toolInput,
    },
    async (args) => {
      const projectKey = projectOf(args);
      const { issues, listing } = await loadIssues(projectKey);
      const versions = await loadVersions(projectKey);
      const findings = findMissingReleaseVersions(issues, versions);
      return {
        projectKey,
        count: findings.length,
        ...listingReport(issues, listing),
        findings: ranked(findings, args.limit ?? 100),
      };
    },
  );

  register(
    "jira_find_stale_blockers",
    {
      title: "Find stale blockers",
      description:
        "Find the open issues that block other issues and have not been updated for the staleness threshold or longer. A blocker of work that already ships is reported as high severity.",
      inputSchema: toolInput.extend({
        staleDays: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "How many days without an update make a blocker stale. Defaults to the configured threshold.",
          ),
      }),
    },
    async (args) => {
      const projectKey = projectOf(args);
      const { issues, listing } = await loadIssues(projectKey);
      const versions = await loadVersions(projectKey);
      const findings = findStaleBlockers(issues, versions, {
        staleDays: args.staleDays ?? options.staleDays,
        maxDepth: options.maxDepth,
        now: now(),
      });
      return {
        projectKey,
        count: findings.length,
        ...listingReport(issues, listing),
        findings: ranked(findings, args.limit ?? 100),
      };
    },
  );

  register(
    "jira_find_broken_hierarchies",
    {
      title: "Find broken hierarchies",
      description:
        "Find the broken issue hierarchies: a parent or epic that does not exist, a parent chain that loops, and a hierarchy that is deeper than the depth limit.",
      inputSchema: toolInput.extend({
        maxDepth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "How many levels deep a hierarchy may be. Defaults to the configured limit.",
          ),
      }),
    },
    async (args) => {
      const projectKey = projectOf(args);
      const { issues, listingComplete, epicLinkKnown, listing } =
        await loadIssues(projectKey);
      const findings = findBrokenHierarchies(issues, {
        staleDays: options.staleDays,
        maxDepth: args.maxDepth ?? options.maxDepth,
        now: now(),
        listingComplete,
        epicLinkKnown,
      });
      return {
        projectKey,
        count: findings.length,
        ...listingReport(issues, listing),
        findings: ranked(findings, args.limit ?? 100),
      };
    },
  );

  register(
    "jira_find_issue_hygiene_problems",
    {
      title: "Find the issues that are not kept well enough to be worked on",
      description:
        "Find the issues that are not kept well enough to be worked on: no summary, no description, work in progress without an assignee, no priority, a due date that has passed while the issue is still open, and work in progress that has not been updated for the staleness threshold.",
      inputSchema: toolInput.extend({
        staleInProgressDays: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "How many days without an update make work in progress stale. Defaults to the configured threshold.",
          ),
      }),
    },
    async (args) => {
      const projectKey = projectOf(args);
      const { issues, listing } = await loadIssues(projectKey, {
        hygiene: true,
      });
      const findings = findHygieneProblems(issues, {
        staleInProgressDays:
          args.staleInProgressDays ?? options.staleInProgressDays,
        now: now(),
      });
      return {
        projectKey,
        count: findings.length,
        ...listingReport(issues, listing),
        findings: ranked(findings, args.limit ?? 100),
      };
    },
  );

  register(
    "jira_check_installation",
    {
      title: "Check the health of the installation",
      description:
        "Report the health of the Jira installation: the deployment type and version of the instance, the health checks the instance reports about itself, whether the project can be read, and the guidance that holds for that deployment.",
      // The report has no findings to cap, so it takes no limit.
      inputSchema: z.object({
        projectKey: z
          .string()
          .optional()
          .describe("The project to report on. Defaults to the configured project."),
      }),
    },
    async (args) => {
      const projectKey = projectOf(args);
      const serverInfo = await options.reader.getServerInfo();

      // A project that cannot be read is a finding of the report, not a
      // failure of the tool: the rest of the installation is still worth
      // reporting.
      let project: ProjectSummary | undefined;
      let projectError: string | undefined;
      try {
        project = await options.reader.getProject(projectKey);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // The message travels in a tool result, so it goes through the same
        // redaction as every other message.
        projectError = redact(message, secrets);
      }

      return checkInstallation({
        serverInfo,
        projectKey,
        project,
        projectError,
      });
    },
  );

  register(
    "jira_health_summary",
    {
      title: "Summarize the health of the project",
      description:
        "Summarize the health of the project: the number of findings per category and severity, and the findings to look at first. The status is healthy when there is nothing to report.",
      inputSchema: toolInput.extend({
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("How many findings to list. Defaults to 10."),
        staleDays: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            "How many days without an update make a blocker stale. Defaults to the configured threshold.",
          ),
        maxDepth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "How many levels deep a hierarchy may be. Defaults to the configured limit.",
          ),
        staleInProgressDays: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "How many days without an update make work in progress stale. Defaults to the configured threshold.",
          ),
      }),
    },
    async (args) => {
      const projectKey = projectOf(args);
      const { issues, listingComplete, epicLinkKnown, listing } =
        await loadIssues(projectKey, { hygiene: true });
      const versions = await loadVersions(projectKey);
      const findings = [
        ...findOrphanedIssues(issues, {
          listingComplete,
          epicLinkKnown,
        }),
        ...findMissingReleaseVersions(issues, versions),
        ...findStaleBlockers(issues, versions, {
          staleDays: args.staleDays ?? options.staleDays,
          maxDepth: options.maxDepth,
          now: now(),
        }),
        ...findBrokenHierarchies(issues, {
          staleDays: options.staleDays,
          maxDepth: args.maxDepth ?? options.maxDepth,
          now: now(),
          listingComplete,
          epicLinkKnown,
        }),
        ...findHygieneProblems(issues, {
          staleInProgressDays:
            args.staleInProgressDays ?? options.staleInProgressDays,
          now: now(),
        }),
      ];
      const summary = summarizeHealth(findings, { limit: args.limit ?? 10 });
      return {
        projectKey,
        generatedAt: now().toISOString(),
        ...listingReport(issues, listing),
        ...summary,
      };
    },
  );

  return server;
}
