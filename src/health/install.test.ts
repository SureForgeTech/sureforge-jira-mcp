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
};

const DATA_CENTER: ServerInfo = {
  version: "9.12.0",
  deploymentType: "Data Center",
  healthChecks: [],
};

const SERVER: ServerInfo = {
  version: "9.4.0",
  deploymentType: "Server",
  healthChecks: [],
};

test("the deployment type is read from what the instance reports", () => {
  assert.equal(deploymentTypeOf(CLOUD), "cloud");
  assert.equal(deploymentTypeOf(DATA_CENTER), "data-center");
  assert.equal(deploymentTypeOf(SERVER), "server");
});

test("a deployment type this server does not know is unknown", () => {
  assert.equal(
    deploymentTypeOf({ deploymentType: "Mainframe", healthChecks: [] }),
    "unknown",
  );
  assert.equal(deploymentTypeOf({ healthChecks: [] }), "unknown");
  assert.equal(
    deploymentTypeOf({ deploymentType: "  ", healthChecks: [] }),
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
    },
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
    projectError: "Jira answered 404 Not Found for /rest/api/3/project/EXAMPLE.",
  });
  assert.equal(report.status, "needs-attention");
  assert.equal(report.project.found, false);
  assert.equal(report.project.key, "");
  assert.match(report.project.error ?? "", /404/);
});

test("the report says which deployment type the instance reported", () => {
  const report = checkInstallation({
    serverInfo: DATA_CENTER,
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
