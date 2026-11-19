## Outcome

The Epic Link field is read by an id the site can answer, and the listing no longer claims to cover a project it did not read.

This follows #4, which carried the five health tools. It holds the last review round's findings.

## Scope

- `JIRA_EPIC_LINK_FIELD` names the Epic Link field, `customfield_10014` by default. The id is site-specific: a project in the classic layout, or a Jira Server instance, uses another one, and with the old hard-coded id the epic was never read, so the epic and every task under it were reported as orphans.
- A site that refuses the request (HTTP 400) is read without the field instead of failing every tool.
- The listing stops when a site repeats a page, instead of reading the same issues fifty times.
- The listing counts the issues it left out because they carried no key. Such an issue may point at another one, so the listing is incomplete when any was left out, and the findings that depend on the absence of an issue are softened.
- The end-to-end test answers the search endpoint the way a current site does, so it exercises a complete listing and findings that are not softened.
- The tests that were meant to pin the raw-count fix now hold a full page of issues without a key, the case that ended the listing before. The earlier version of the test passed against the code it replaced.

## Acceptance evidence

- `npm ci` succeeds from the committed lockfile.
- `npm run check` exits 0: type check, publish build, 134 unit tests, 2 end-to-end tests, 0 failing.
- The regression test fails when the fix it covers is reverted.

## Validation

```
npm ci
npm run check
```

Tested revision: `283de5bec776fb8315758e98247125f3c4c1158d` (branch `fix/listing-honesty`, base `main`).

## Risk

The Epic Link id cannot be confirmed for every site from here. The default is the id Jira Cloud and Jira Server use, the id is configurable, and a site that refuses the request is read without the field, so the failure mode is a missing epic link rather than a broken listing.
