# Handoff — sureforge-jira-mcp

## Goal

Ship the Jira health MCP server for `SureForgeTech/sureforge-jira-mcp`: five read-only
tools (orphaned issues, missing release versions, stale blockers, broken hierarchies,
health summary) over a pure rules engine, a Jira REST client, and a declared validation
command — with an independent review of each exact head and the work merged to `main`.

## Done and tested

- **PR #4 is merged into `main`** as `5c3b75e` ("feat: publish the five Jira health tools"):
  the scaffold, the five tools, the pure rules in `src/health/`, the REST client in
  `src/jira/`, the environment-only configuration with credential redaction, the declared
  validation (`npm run check`), the README/AGENTS/CHANGELOG rules and the test suite.
- **PR #5 is merged into `main`** as `6a42fe9` ("fix: keep the listing honest about what
  it does not know"), merged 2026-11-19T02:00:24Z. It carried three commits:
  - `283de5b` fix: keep the listing honest about what it does not know
  - `8913e32` fix: read the Epic Link field that was asked for and say what is unknown
  - `614ee0c` fix: hedge the findings that depend on what the listing does not know
  No pull request is open on the repository.
- **The two P1 findings of the last review of `614ee0c` are fixed** in the WIP commit
  `c9b76bb` on `wip/jira-mcp-health-tools`:
  1. A configured Epic Link id that names a base field (`project`, `summary`, …) reached
     the normalizer and fabricated an epic relation for every issue. One helper now
     decides both what is requested and what is read: `epicLinkFieldOrUndefined` in
     `src/jira/client.ts:77`.
  2. `complete` was coupled to the epic relation, so a genuinely missing parent was
     downgraded to low severity and worded "does not cover the whole project" even when
     the listing covered it. `covered` (the listing covers the project) and
     `epicLinkKnown` (the epic relation is known) are separate facts now:
     `src/health/rules.ts:124` and `:327`, `src/server.ts:131-143`.
- **Tests:** `npm test` on the WIP tree → **149 tests, 149 pass, 0 fail**;
  `npm run typecheck` clean.

## Half-done

The WIP commit holds the two P1 fixes and their tests, and that tree is green. Not
addressed:

- **[P2] `issuesDropped` documentation is wrong.** The counter counts both the issues the
  site returned without a key *and* the issues the issue cap cut off; the documentation
  says only the first: `README.md:23` and the `dropped` doc comment in
  `src/jira/types.ts:94`.
- **[P3] `readEpicLinkField(env)` is evaluated twice** in `src/config.ts:185-187`
  (harmless, the function is pure).
- **[P3] A site that refuses the Epic Link field costs one extra failing request per
  tool call**, because the refusal is tracked per listing and the client is shared by the
  five tools.
- **[P3] The plumbing from `JIRA_EPIC_LINK_FIELD` to the client** is covered by the
  configuration test and the client test, but not by a test that starts at the
  environment variable.

## Important: `main` has moved past this branch

`origin/main` is `6a42fe9` and its tree carries **more than the branch this WIP was
built on** (`614ee0c`): `git diff 614ee0c origin/main` shows 661 added lines across 12
files, including work this session did not write — `effectiveEpicLinkField` and
`hasUnusableEpicValue` in `src/jira/normalize.ts`, a different shape for the
`issueFields` guard in `src/jira/client.ts`, and extra tests in `src/jira/client.test.ts`
and `src/server.test.ts`. Another session worked in this repository and its work reached
`main` while this one was closing.

The WIP branch is therefore based on an older tree than `main`. It must be brought onto
`main` before it can be proposed, and the overlap is exactly where the two P1 fixes
live (`src/jira/client.ts`, `src/health/rules.ts`, `src/server.ts`).

## Exact next step

1. `git rebase origin/main` (or `git merge origin/main`) on `wip/jira-mcp-health-tools`,
   and resolve the overlap in `src/jira/client.ts`, `src/jira/normalize.ts`,
   `src/health/rules.ts` and `src/server.ts`: the other session's
   `effectiveEpicLinkField` and `hasUnusableEpicValue` already cover the base-field
   guard, so this branch's `epicLinkFieldOrUndefined` may be redundant, and its
   `covered`/`epicLinkKnown` split may need to be re-applied on top of the newer rule
   signatures.
2. `npm run check` → green.
3. Fix the `issuesDropped` wording (`README.md:23`, `src/jira/types.ts:94`).
4. Run one independent fresh-context review of that exact head (see the provider note).
5. Open a pull request from `wip/jira-mcp-health-tools` and merge it with `--squash`.

## Branch, commit, pull request

- Branch: `wip/jira-mcp-health-tools` (from `fix/listing-honesty` at `614ee0c`).
- Latest commit: `c9b76bbf2bb82601bbca75ad86f9d85d41110be8` — "WIP: fix the two P1
  findings of the last review of the exact head", plus the handoff commit that follows it.
- No pull request is open. PR #4 merged as `5c3b75e`, PR #5 merged as `6a42fe9`.
- The remote branch `fix/listing-honesty` was deleted after PR #5 merged; its content is
  in `main`.

## Decisions and why

- **TypeScript, Node's test runner, no test framework.** The organization runs an MCP
  server with exactly this stack (`sureforge-zendesk/plugins/zendesk-connector`), so the
  house style was followed rather than a new one invented.
- **The rules are pure functions; the reference time is a parameter.** The review
  checked that `src/health/` contains no clock, environment or network access, so the
  tests are deterministic.
- **The listing reports what it does not know.** `truncated`, `issuesDropped` and
  `epicLinkKnown` exist because the rules must never state as fact that an issue does
  not exist when the listing may be missing it.
- **No CI workflow was added.** The sandbox token has no Workflows permission, so
  workflow files are made outside the sandbox; the declared validation is local.
- **The five tools are the product, the client is transport.** The client owns
  authentication, timeouts, pagination, the endpoint fallback and the error mapping; the
  tools own the findings.
- **Reviews ran on the session's own funded provider.** Kimi and OpenCode Go both
  reported exhausted 5-hour allowances, and `cursor-agent` is not installed in this VM
  (the updated AGENTS.md says it is). The updated rule counts the same model in a fresh
  context as independent, so each review was a fresh session that re-derived the verdict
  from the diff and never from the author's conclusions.

## Blockers

None for the remaining work. Earlier, resolved:

- GitHub token expiry mid-session: `HTTP 401: Bad credentials`. The sandbox re-issues
  the one-hour token in `/var/lib/opencode-github/github.token`; it worked again
  afterwards.
- Push rejected while the branch was behind `main`: `refusing to allow a GitHub App to
  create or update workflow '.github/workflows/dco.yml' without 'workflows' permission`.
  Fixed by branching from `origin/main` and cherry-picking the work onto it.
- Kimi: `You've reached your 5-hour usage limit.` OpenCode Go: `OpenCode Go usage limit
  reached (5-hour, resets in 3h 58m).` OpenCode free tier: `Free usage limit reached.`
  All are provider allowances; the fallback above was used.
- The org ruleset "Public repositories: changes to main through pull requests" now has
  `required_approving_review_count: 0`, so no approval from the
  `abd-oss-lane-reviewer[bot]` app is needed. `main` still accepts changes only through
  pull requests, and squash is the only allowed merge method.

## Ignored and untracked files that matter

From `git status --ignored --short` in `/workspace/sureforge-jira-mcp`:

- `!! dist/` — build output (`tsc` output), gitignored, regenerated by `npm run check`.
- `!! node_modules/` — installed dependencies, gitignored, restored by `npm ci` from the
  committed `package-lock.json`.

No untracked source files and no scratch files inside the repository, apart from the
handoff material added under `docs/handoff/`. The reviewer's probe and revert scripts are
copied there from `/tmp/opencode/probe/`; the pull-request bodies are copied there from
`/workspace/.pr-bodies/`.
