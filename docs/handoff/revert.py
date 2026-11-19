#!/usr/bin/env python3
"""Apply one named revert to the scratch copy, build and run the unit tests."""
import json
import shutil
import subprocess
import sys
import os

ROOT = "/tmp/opencode/probe"
PRISTINE = os.path.join(ROOT, "pristine")

REVERTS = {
    # 1. the repeat detection in the cursor branch
    "repeat-cursor": ("src/jira/client.ts",
        """        } else if (pageIssues.length > 0 && fresh.length === 0) {
          // The site repeats a page: every issue on it was read before.
          // Reading it again would only repeat the same issues.
          sourceHasMore = false;
          unreadable = true;
""",
        """        } else if (pageIssues.length === 0) {
          sourceHasMore = false;
          unreadable = true;
"""),
    # 2. the repeat detection in the offset branch
    "repeat-offset": ("src/jira/client.ts",
        """          } else if (pageIssues.length > 0 && fresh.length === 0) {
            // The site repeats a page.
            sourceHasMore = false;
            unreadable = true;
""",
        """          } else if (pageIssues.length === 0) {
            sourceHasMore = false;
            unreadable = true;
"""),
    # 3. the dropped counter
    "dropped": ("src/jira/client.ts",
        """      truncated: stopReason !== "source" || dropped > 0,""",
        """      truncated: stopReason !== "source" || dropped > 0, // keep
"""),
    # 4. epicLinkKnown always true
    "epic-link-known": ("src/jira/client.ts",
        """      epicLinkKnown: !this.epicLinkFieldRefused,""",
        """      epicLinkKnown: true,"""),
    # 5. the 400 refusal fallback removed (base behaviour: throw)
    "no-refusal-fallback": ("src/jira/client.ts",
        """        if (
          isRefusedRequest(error) &&
          !this.epicLinkFieldRefused &&
          this.epicLinkField !== undefined
        ) {""",
        """        if (
          false &&
          isRefusedRequest(error) &&
          !this.epicLinkFieldRefused &&
          this.epicLinkField !== undefined
        ) {"""),
    # 6. the offset path without a total: base behaviour (short page = complete)
    "offset-short-page": ("src/jira/client.ts",
        """          if (rawCount >= requested) {
            sourceHasMore = true;
          } else {
            sourceHasMore = false;
            unreadable = true;
          }""",
        """          sourceHasMore = rawCount >= requested;"""),
    # 7. the cursor branch: a page whose issues have no key ends the listing (base)
    "cursor-keyless-page": ("src/jira/client.ts",
        """        } else if (rawCount === 0) {""",
        """        } else if (pageIssues.length === 0) {"""),
    # 8. the configured field value is not read
    "configured-field-not-read": ("src/jira/normalize.ts",
        """    (epicLinkField === undefined
      ? undefined
      : epicLinkKey((fields as Record<string, unknown>)[epicLinkField])) ??
    epicLinkKey(fields.epicLink) ??""",
        """    epicLinkKey(fields.epicLink) ??"""),
    # 9. the refusal is only answered on the first request (base ordering)
    "refusal-first-request-only": ("src/jira/client.ts",
        """        if (
          isRefusedRequest(error) &&
          !this.epicLinkFieldRefused &&
          this.epicLinkField !== undefined
        ) {""",
        """        if (
          isRefusedRequest(error) &&
          !this.epicLinkFieldRefused &&
          this.epicLinkField !== undefined &&
          this.searchPath === undefined
        ) {"""),
    # 10. the server does not fold epicLinkKnown into `complete`
    "complete-without-epic": ("src/server.ts",
        """      complete: !listing.truncated && listing.epicLinkKnown,""",
        """      complete: !listing.truncated,"""),
    # 11. the listing report does not carry issuesDropped / epicLinkKnown
    "listing-report": ("src/server.ts",
        """    ...(listing.dropped > 0 ? { issuesDropped: listing.dropped } : {}),
    ...(listing.epicLinkKnown ? {} : { epicLinkKnown: false }),""",
        """"""),
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
