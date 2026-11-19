#!/usr/bin/env python3
"""Third batch: revert the e2e mock change and re-run the end-to-end test."""
import json
import shutil
import subprocess
import sys
import os

ROOT = "/tmp/opencode/probe"
PRISTINE = os.path.join(ROOT, "pristine")

REVERTS = {
    # the mock no longer says the page is the last one
    "e2e-no-islast": ("e2e/smoke.test.mjs",
        """    response.end(
      JSON.stringify({ issues: MOCK_ISSUES, total: MOCK_ISSUES.length, isLast: true }),
    );""",
        """    response.end(
      JSON.stringify({ issues: MOCK_ISSUES, total: MOCK_ISSUES.length }),
    );"""),
    # the e2e no longer asserts that the listing was complete
    "e2e-no-assert": ("e2e/smoke.test.mjs",
        """  assert.equal(
    summary.truncated,
    undefined,
    "the listing was complete, so the findings are not softened",
  );""",
        ""),
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
build = subprocess.run(["npm", "run", "build"], cwd=ROOT, capture_output=True, text=True)
if build.returncode != 0:
    print(f"REVERT {name}: BUILD FAILED\n{build.stdout}\n{build.stderr}")
    sys.exit(3)
run = subprocess.run(["node", "scripts/run-tests.mjs", "e2e"], cwd=ROOT, capture_output=True, text=True)
fails = [line.split(" - ", 1)[1] for line in run.stdout.splitlines() if line.startswith("not ok ")]
print(f"REVERT {name}: exit={run.returncode} failing_tests={json.dumps(fails, indent=1)}")
