#!/usr/bin/env python3
"""Fourth batch: is the JIRA_EPIC_LINK_FIELD plumbing covered by any test?"""
import json
import shutil
import subprocess
import sys
import os

ROOT = "/tmp/opencode/probe"
PRISTINE = os.path.join(ROOT, "pristine")

REVERTS = {
    # the configuration no longer reads the variable
    "config-no-epic-var": ("src/config.ts",
        """    ...(env.JIRA_EPIC_LINK_FIELD === undefined ||
    env.JIRA_EPIC_LINK_FIELD.trim() === ""
      ? {}
      : { epicLinkField: env.JIRA_EPIC_LINK_FIELD.trim() }),""",
        ""),
    # the entry point no longer passes the field to the client
    "index-no-epic-var": ("src/index.ts",
        """    ...(config.epicLinkField === undefined
      ? {}
      : { epicLinkField: config.epicLinkField }),""",
        ""),
    # the client ignores the configured field id when it builds the request
    "client-ignores-configured-field": ("src/jira/client.ts",
        """        fields: issueFields(
          this.epicLinkFieldRefused ? undefined : this.epicLinkField,
        ),""",
        """        fields: issueFields(undefined),"""),
}

name = sys.argv[1]
path, old, new = REVERTS[name]
shutil.rmtree(os.path.join(ROOT, "src"))
shutil.copytree(os.path.join(PRISTINE, "src"), os.path.join(ROOT, "src"))
target = os.path.join(ROOT, path)
with open(target) as f:
    text = f.read()
if old not in text:
    print(f"REVERT {name}: PATTERN NOT FOUND in {path}")
    sys.exit(2)
with open(target, "w") as f:
    f.write(text.replace(old, new, 1))
build = subprocess.run(["npm", "run", "build:test"], cwd=ROOT, capture_output=True, text=True)
if build.returncode != 0:
    print(f"REVERT {name}: BUILD FAILED\n{build.stdout}\n{build.stderr}")
    sys.exit(3)
run = subprocess.run(["node", "scripts/run-tests.mjs", "dist"], cwd=ROOT, capture_output=True, text=True)
fails = [line.split(" - ", 1)[1] for line in run.stdout.splitlines() if line.startswith("not ok ")]
print(f"REVERT {name}: exit={run.returncode} failing_tests={json.dumps(fails, indent=1)}")
