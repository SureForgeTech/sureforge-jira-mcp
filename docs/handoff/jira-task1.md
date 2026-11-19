## Outcome

The repository gains a reproducible build and a declared validation command. Until now it had no source, no dependency manifest and no way to run a check, so no change could be validated.

## Scope

- `package.json`, the committed `package-lock.json`, `tsconfig.json` and `tsconfig.build.json`: `npm ci` reproduces the build from the lockfile alone.
- `src/`: the server entry point with `--version`, `--help` and `--healthcheck`, plus a test beside each module.
- `AGENTS.md`: the repository-specific section now names the validation command, the merge rule and the changelog rule.
- `CHANGELOG.md`: the file the changelog rule refers to.

No MCP tools and no Jira logic here: the stdio server and its tools are wired up in a later change. No workflow file is touched (the sandbox token has no Workflows permission).

## Acceptance evidence

- `npm ci` succeeds from the committed lockfile.
- `npm run check` (type check, build, test suite) exits 0 with 17 passing tests and 0 failing.
- The version in `package.json` and `src/version.ts` are checked against each other by a test.

## Validation

```
npm ci
npm run check
```

Tested revision: `6d0df648237d89214c0d9fca078952a62853255d` (branch `feat/bootstrap-scaffold`, base `main`).

## Risk

The stack is new to this repository; it follows the toolchain the organization's other MCP server uses (TypeScript, Node's test runner, the same tsconfig shape). The MCP SDK dependency arrives with the server wiring, not here.
