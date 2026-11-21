/**
 * The installation health report.
 *
 * The rule is a pure function: it reads what the instance and the project
 * reported and turns it into a report. It never calls Jira, so the report can
 * be tested without a network and without a credential.
 */
import type {
  InstanceHealthCheck,
  ProjectSummary,
  ServerInfo,
} from "../jira/types.js";

/** What the report says about the health of the installation. */
export type InstallationStatus = "healthy" | "needs-attention";

/** The deployment types the report knows. */
export type DeploymentType = "cloud" | "data-center" | "server" | "unknown";

/** Whether Atlassian still supports the deployment. */
export type SupportStatus = "supported" | "end-of-support" | "unknown";

/** The report of the installation health. */
export interface InstallationReport {
  /** Whether the installation is healthy. */
  readonly status: InstallationStatus;
  /** The deployment the instance reports. */
  readonly deployment: {
    /** The deployment type, lower-cased and normalized. */
    readonly type: DeploymentType;
    /** The deployment type as the instance names it. */
    readonly reportedType?: string;
    /** The version of Jira. */
    readonly version?: string;
    /** The build number of the instance. */
    readonly buildNumber?: number;
    /** The title of the instance. */
    readonly title?: string;
    /** Whether Atlassian still supports the deployment. */
    readonly support: SupportStatus;
  };
  /** The health checks the instance reports about itself. */
  readonly healthChecks: readonly InstanceHealthCheck[];
  /**
   * Whether the instance reports health checks at all.
   *
   * Jira Cloud does not, so an instance without checks is not an instance
   * without health: there was no evidence to report.
   */
  readonly healthChecksReported: boolean;
  /** The health checks that did not pass. */
  readonly failingHealthChecks: readonly InstanceHealthCheck[];
  /** The project the report is about. */
  readonly project: {
    /** The key of the project that was asked for. */
    readonly key: string;
    /** Whether the project was found and may be read. */
    readonly found: boolean;
    /** The name of the project. */
    readonly name?: string;
    /** The type of the project. */
    readonly type?: string;
    /** The issue types the project offers. */
    readonly issueTypes?: readonly string[];
    /** Why the project could not be read, when it could not. */
    readonly error?: string;
  };
  /** The guidance that holds for this deployment. */
  readonly guidance: readonly string[];
}

/** What the report is built from. */
export interface InstallationInput {
  /** What the instance reported about itself. */
  readonly serverInfo: ServerInfo;
  /** The key of the project that was asked for. */
  readonly projectKey: string;
  /** The project, when it was found. */
  readonly project?: ProjectSummary;
  /** The reason the project could not be read, when it could not. */
  readonly projectError?: string;
}

/**
 * The deployment type of an instance.
 *
 * The instance names it: `Cloud`, `Data Center` or `Server`. A site that
 * reports nothing, or reports something this server does not know, is
 * `unknown`, and the report says so rather than guessing.
 */
export function deploymentTypeOf(serverInfo: ServerInfo): DeploymentType {
  const reported = serverInfo.deploymentType?.trim().toLowerCase();
  if (reported === undefined || reported === "") {
    return "unknown";
  }
  if (reported === "cloud") {
    return "cloud";
  }
  if (reported === "data center" || reported === "datacenter") {
    return "data-center";
  }
  if (reported === "server") {
    return "server";
  }
  return "unknown";
}

/**
 * The guidance that holds for a deployment.
 *
 * The facts are the ones Atlassian documents: who runs the instance, who
 * upgrades it, and which parts of the REST API it serves.
 */
/**
 * Whether Atlassian still supports the deployment.
 *
 * Cloud is supported, because Atlassian runs it. Jira Server is not, since
 * Atlassian ended its support in February 2024. The support of a Data
 * Center release depends on that release, and this server does not carry
 * the lifecycle table, so it reports `unknown` and names the version the
 * instance reported.
 */
export function supportOf(deployment: DeploymentType): SupportStatus {
  switch (deployment) {
    case "cloud":
      return "supported";
    case "data-center":
      return "unknown";
    case "server":
      return "end-of-support";
    case "unknown":
      return "unknown";
  }
}

export function guidanceFor(deployment: DeploymentType): string[] {
  switch (deployment) {
    case "cloud":
      return [
        "Atlassian runs this instance: it is upgraded and maintained by Atlassian.",
        "The current search endpoint is /rest/api/3/search/jql; the earlier /rest/api/3/search is being retired.",
      ];
    case "data-center":
      return [
        "This instance is run by your organisation: the version is the one to plan upgrades for.",
        "Jira Data Center documents REST API version 2; a Data Center instance answers 404 for a version 3 path, so this server reads the earlier version there.",
        "The support of a Data Center release depends on that release: check the Atlassian lifecycle page for the version this instance reported.",
      ];
    case "server":
      return [
        "Atlassian ended support for Jira Server in February 2024, so this instance receives no fixes.",
        "This instance is run by your organisation: the version is the one to plan upgrades for.",
      ];
    case "unknown":
      return [
        "The instance did not report a deployment type this server knows, so no deployment guidance can be given.",
        "An instance that does not report its version or its deployment type cannot be checked for support status.",
      ];
  }
}

/**
 * Build the installation health report.
 *
 * The report is `needs-attention` when a health check of the instance failed
 * or when the project could not be read. Everything else is healthy.
 */
export function checkInstallation(input: InstallationInput): InstallationReport {
  const deployment = deploymentTypeOf(input.serverInfo);
  const healthChecks = input.serverInfo.healthChecks ?? [];
  const failing = healthChecks.filter((check) => check.passed === false);
  const projectFound = input.project !== undefined;
  // An instance that said nothing about itself was not checked, so the
  // report cannot call the installation healthy on that basis.
  const instanceReported =
    input.serverInfo.deploymentType !== undefined ||
    input.serverInfo.version !== undefined;

  return {
    status:
      failing.length === 0 && projectFound && instanceReported
        ? "healthy"
        : "needs-attention",
    deployment: {
      type: deployment,
      ...(input.serverInfo.deploymentType === undefined
        ? {}
        : { reportedType: input.serverInfo.deploymentType }),
      ...(input.serverInfo.version === undefined
        ? {}
        : { version: input.serverInfo.version }),
      ...(input.serverInfo.buildNumber === undefined
        ? {}
        : { buildNumber: input.serverInfo.buildNumber }),
      ...(input.serverInfo.serverTitle === undefined
        ? {}
        : { title: input.serverInfo.serverTitle }),
      support: supportOf(deployment),
    },
    healthChecks,
    healthChecksReported: input.serverInfo.healthChecksReported,
    failingHealthChecks: failing,
    project: {
      key: input.project?.key ?? input.projectKey,
      found: projectFound,
      ...(input.project?.name === undefined ? {} : { name: input.project.name }),
      ...(input.project?.projectTypeKey === undefined
        ? {}
        : { type: input.project.projectTypeKey }),
      ...(input.project === undefined ? {} : { issueTypes: input.project.issueTypes }),
      ...(input.projectError === undefined
        ? {}
        : { error: input.projectError }),
    },
    guidance: guidanceFor(deployment),
  };
}
