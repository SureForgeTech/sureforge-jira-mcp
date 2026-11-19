#!/usr/bin/env python3
"""Second batch of targeted reverts against the scratch copy."""
import json
import shutil
import subprocess
import sys
import os

ROOT = "/tmp/opencode/probe"
PRISTINE = os.path.join(ROOT, "pristine")

REVERTS = {
    # A. the dropped counter is not part of `truncated` any more
    "truncated-without-dropped": ("src/jira/client.ts",
        """      truncated: stopReason !== "source" || dropped > 0,""",
        """      truncated: stopReason !== "source","""),
    # B. the dropped counter is not computed at all
    "no-dropped-counter": ("src/jira/client.ts",
        """      dropped += rawCount - pageIssues.length;""",
        """      dropped += 0;"""),
    # C. the tool result does not carry issuesDropped
    "no-issues-dropped-report": ("src/server.ts",
        """    ...(listing.dropped > 0 ? { issuesDropped: listing.dropped } : {}),""",
        ""),
    # D. the tool result reports `truncated` from `complete` (base behaviour)
    "truncated-from-complete": ("src/server.ts",
        """    ...(listing.truncated ? { truncated: true } : {}),""",
        """    ...(complete ? {} : { truncated: true }),"""),
    # E. the listing report loses the truncated flag altogether
    "no-truncated-report": ("src/server.ts",
        """    ...(listing.truncated ? { truncated: true } : {}),""",
        ""),
    # F. the offset branch repeat detection removed (only that hunk)
    "repeat-offset-only": ("src/jira/client.ts",
        """          } else if (pageIssues.length > 0 && fresh.length === 0) {
            // The site repeats a page.
            sourceHasMore = false;
            unreadable = true;
""",
        ""),
    # G. the seenKeys de-duplication removed (issues may repeat)
    "no-dedupe": ("src/jira/client.ts",
        """      const fresh = pageIssues.filter((issue) => !seenKeys.has(issue.key));""",
        """      const fresh = pageIssues;"""),
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
