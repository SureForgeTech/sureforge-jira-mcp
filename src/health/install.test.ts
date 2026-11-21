import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkInstallation,
  deploymentTypeOf,
  guidanceFor,
  type DeploymentType,
} from "./install.js";
import type { ServerInfo } from "../jira/types.js";

const CLOUD: ServerInfo = {
  baseUrl: "https://example.atlassian.net",
  version: "1001.0.0",
  deploymentType: "Cloud",
  buildNumber: 1001,
  serverTitle: "Jira",
  healthChecks: [],
  healthChecksReported: false,
};

const DATA_CENTER: ServerInfo = {
  version: "9.12.0",
  deploymentType: "Data Center",
  healthChecks: [],
  healthChecksReported: false,
};

const SERVER: ServerInfo = {
  version: "9.4.0",
  deploymentType: "Server",
  healthChecks: [],
  healthChecksReported: false,
};

test("the deployment type is read from what the instance reports", () => {
  assert.equal(deploymentTypeOf(CLOUD), "cloud");
  assert.equal(deploymentTypeOf(DATA_CENTER), "data-center");
  assert.equal(deploymentTypeOf(SERVER), "server");
});

test("a deployment type this server does not know is unknown", () => {
  assert.equal(
    deploymentTypeOf({
      deploymentType: "Mainframe",
      healthChecks: [],
      healthChecksReported: false,
    }),
    "unknown",
  );
  assert.equal(deploymentTypeOf({ healthChecks: [], healthChecksReported: false }), "unknown");
  assert.equal(
    deploymentTypeOf({
      deploymentType: "  ",
      healthChecks: [],
      healthChecksReported: false,
    }),
    "unknown",
  );
});

test("the guidance names who runs the instance", () => {
  const cloud = guidanceFor("cloud").join(" ");
  assert.match(cloud, /Atlassian runs this instance/);

  const dataCenter = guidanceFor("data-center").join(" ");
  assert.match(dataCenter, /run by your organisation/);

  const server = guidanceFor("server").join(" ");
  assert.match(server, /ended support for Jira Server in February 2024/);
});

test("an unknown deployment gets no deployment guidance", () => {
  const guidance = guidanceFor("unknown").join(" ");
  assert.match(guidance, /did not report a deployment type/);
});

test("a healthy installation with a readable project is healthy", () => {
  const report = checkInstallation({
    serverInfo: CLOUD,
    projectKey: "EXAMPLE",
    project: {
      key: "EXAMPLE",
      name: "Example project",
      projectTypeKey: "software",
      issueTypes: ["Task"],
    },
  });
  assert.equal(report.status, "healthy");
  assert.equal(report.project.found, true);
  assert.equal(report.project.key, "EXAMPLE");
  assert.equal(report.project.name, "Example project");
  assert.deepEqual(report.project.issueTypes, ["Task"]);
  assert.equal(report.deployment.type, "cloud");
  assert.equal(report.deployment.version, "1001.0.0");
  assert.equal(report.deployment.buildNumber, 1001);
  assert.equal(report.deployment.title, "Jira");
});

test("a health check of the instance that did not pass needs attention", () => {
  const report = checkInstallation({
    serverInfo: {
      ...CLOUD,
      healthChecks: [
        { name: "Database", passed: true },
        { name: "Disk space", description: "Low", passed: false },
      ],
      healthChecksReported: true,
    },
    projectKey: "EXAMPLE",
    project: { key: "EXAMPLE", issueTypes: [] },
  });
  assert.equal(report.status, "needs-attention");
  assert.equal(report.healthChecks.length, 2);
  assert.equal(report.failingHealthChecks.length, 1);
  assert.equal(report.failingHealthChecks[0].name, "Disk space");
});

test("a project that cannot be read needs attention", () => {
  const report = checkInstallation({
    serverInfo: CLOUD,
    projectKey: "EXAMPLE",
    projectError: "Jira answered 404 Not Found for /rest/api/3/project/EXAMPLE.",
  });
  assert.equal(report.status, "needs-attention");
  assert.equal(report.project.found, false);
  assert.equal(report.project.key, "EXAMPLE");
  assert.match(report.project.error ?? "", /404/);
});

test("the report says which deployment type the instance reported", () => {
  const report = checkInstallation({
    serverInfo: DATA_CENTER,
    projectKey: "EXAMPLE",
    project: { key: "EXAMPLE", issueTypes: [] },
  });
  assert.equal(report.deployment.type, "data-center");
  assert.equal(report.deployment.reportedType, "Data Center");
  assert.equal(report.deployment.version, "9.12.0");
});

test("every deployment has guidance", () => {
  for (const deployment of [
    "cloud",
    "data-center",
    "server",
    "unknown",
  ] as DeploymentType[]) {
    assert.ok(guidanceFor(deployment).length > 0, deployment);
  }
});

test("an instance that reports no health checks says so", () => {
  const report = checkInstallation({
    serverInfo: CLOUD,
    projectKey: "EXAMPLE",
    project: { key: "EXAMPLE", issueTypes: [] },
  });
  assert.equal(report.healthChecksReported, false);
  assert.deepEqual([...report.healthChecks], []);
  assert.deepEqual([...report.failingHealthChecks], []);
  assert.equal(
    report.status,
    "healthy",
    "the project can be read and no check failed",
  );
});

test("a health check whose result the instance did not state is not a failure", () => {
  const report = checkInstallation({
    serverInfo: {
      ...CLOUD,
      healthChecks: [{ name: "Database" }],
      healthChecksReported: true,
    },
    projectKey: "EXAMPLE",
    project: { key: "EXAMPLE", issueTypes: [] },
  });
  assert.equal(report.status, "healthy");
  assert.deepEqual([...report.failingHealthChecks], []);
});

test("a Jira Server deployment is reported as out of support", () => {
  const report = checkInstallation({
    serverInfo: SERVER,
    projectKey: "EXAMPLE",
    project: { key: "EXAMPLE", issueTypes: [] },
  });
  assert.equal(report.deployment.support, "end-of-support");
  assert.equal(report.deployment.type, "server");
});

test("a Cloud deployment is reported as supported", () => {
  const cloud = checkInstallation({
    serverInfo: CLOUD,
    projectKey: "EXAMPLE",
    project: { key: "EXAMPLE", issueTypes: [] },
  });
  assert.equal(cloud.deployment.support, "supported");
});

test("the support of a Data Center release is unknown, because it depends on the release", () => {
  const dataCenter = checkInstallation({
    serverInfo: DATA_CENTER,
    projectKey: "EXAMPLE",
    project: { key: "EXAMPLE", issueTypes: [] },
  });
  assert.equal(dataCenter.deployment.support, "unknown");
  assert.equal(dataCenter.deployment.version, "9.12.0");
  assert.match(
    guidanceFor("data-center").join(" "),
    /lifecycle page/,
    "the guidance points at the lifecycle page",
  );
});

test("the report names the project that was asked for, even when it was not found", () => {
  const report = checkInstallation({
    serverInfo: CLOUD,
    projectKey: "OTHER",
    projectError: "Jira answered 404 Not Found for /rest/api/3/project/OTHER.",
  });
  assert.equal(report.project.key, "OTHER");
  assert.equal(report.project.found, false);
});

test("the guidance for Data Center names the API version it documents", () => {
  const guidance = guidanceFor("data-center").join(" ");
  assert.match(guidance, /REST API version 2/);
  assert.equal(
    guidance.includes("serves both /rest/api/2 and /rest/api/3"),
    false,
    "the claim was wrong for the current Data Center line",
  );
});

test("an instance that says nothing about itself is not healthy", () => {
  const report = checkInstallation({
    serverInfo: { healthChecks: [], healthChecksReported: false },
    projectKey: "EXAMPLE",
    project: { key: "EXAMPLE", issueTypes: [] },
  });
  assert.equal(report.status, "needs-attention");
  assert.equal(report.deployment.type, "unknown");
  assert.equal(report.deployment.support, "unknown");
});

test("an instance with an empty list of checks is not a checked instance", () => {
  const report = checkInstallation({
    serverInfo: {
      deploymentType: "Cloud",
      version: "1001.0.0",
      healthChecks: [],
      healthChecksReported: false,
    },
    projectKey: "EXAMPLE",
    project: { key: "EXAMPLE", issueTypes: [] },
  });
  assert.equal(report.healthChecksReported, false);
  assert.equal(report.status, "healthy");
});
