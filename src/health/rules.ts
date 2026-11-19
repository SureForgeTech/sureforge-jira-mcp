/**
 * The health rules.
 *
 * Every rule is a pure function over normalized issues: no network, no
 * environment, no clock of its own. The reference time is passed in, so the
 * rules are deterministic and their tests do not depend on the day they run.
 */
import type { Finding, Issue, ProjectVersion } from "../jira/types.js";

/** The settings the rules take. */
export interface RuleOptions {
  /** A blocker that has not moved for this many days is stale. */
  readonly staleDays: number;
  /** A hierarchy deeper than this many levels is reported. */
  readonly maxDepth: number;
  /** The reference time the rules measure staleness against. */
  readonly now: Date;
}

/** The default rule settings. */
export const DEFAULT_RULE_OPTIONS: RuleOptions = {
  staleDays: 14,
  maxDepth: 5,
  now: new Date(0),
};

/** Index the issues by key. */
export function indexByKey(
  issues: readonly Issue[],
): Map<string, Issue> {
  const index = new Map<string, Issue>();
  for (const issue of issues) {
    index.set(issue.key, issue);
  }
  return index;
}

/**
 * The keys of the issues that point at the given issue.
 *
 * An issue is pointed at by a child that names it as its parent, and by an
 * issue that names it as its epic. Both count: in a team-managed project the
 * epic of a task is linked through the epic link, and an epic with tasks
 * under it does not stand on its own.
 */
export function issuesPointingAt(
  issues: readonly Issue[],
): Map<string, string[]> {
  const pointing = new Map<string, string[]>();
  const add = (target: string, key: string): void => {
    const list = pointing.get(target) ?? [];
    list.push(key);
    pointing.set(target, list);
  };
  for (const issue of issues) {
    if (issue.parentKey !== undefined) {
      add(issue.parentKey, issue.key);
    }
    if (issue.epicKey !== undefined) {
      add(issue.epicKey, issue.key);
    }
  }
  return pointing;
}

/**
 * The whole days between an ISO timestamp and the reference time.
 *
 * Returns `undefined` when the timestamp cannot be read, so a rule can skip
 * a finding it cannot support instead of guessing.
 */
export function daysSince(timestamp: string, now: Date): number | undefined {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return Math.floor((now.getTime() - parsed) / 86_400_000);
}

/** Whether an issue is still open. */
function isUnresolved(issue: Issue): boolean {
  return issue.resolution === undefined;
}

/** The link type names that describe a blocking relation. */
function blockingRelation(
  type: string,
  direction: "outward" | "inward",
  issueKey: string,
  targetKey: string,
): { blocker: string; blocked: string } | undefined {
  const normalized = type.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "blocks") {
    return direction === "outward"
      ? { blocker: issueKey, blocked: targetKey }
      : { blocker: targetKey, blocked: issueKey };
  }
  if (normalized === "isblockedby") {
    return direction === "outward"
      ? { blocker: targetKey, blocked: issueKey }
      : { blocker: issueKey, blocked: targetKey };
  }
  return undefined;
}

/**
 * Find the issues that stand on their own.
 *
 * An issue is orphaned when nothing points at it and it points at nothing:
 * no parent, no epic, no issue links and no child. A resolved issue is not
 * reported: work that is finished and no longer linked is history, not an
 * orphan.
 *
 * When the listing of the project is not complete, an issue that is not in
 * it may still point at this one, so the finding is reported as low severity
 * and says that nothing in the listing points at the issue.
 *
 * When the epic relation is not known, because the site refused the Epic
 * Link field, the finding cannot say that the issue has no epic: it says the
 * epic is not known, and it is reported as low severity.
 */
export function findOrphanedIssues(
  issues: readonly Issue[],
  options?: { complete?: boolean; epicLinkKnown?: boolean },
): Finding[] {
  const pointing = issuesPointingAt(issues);
  const complete = options?.complete ?? true;
  const epicLinkKnown = options?.epicLinkKnown ?? true;
  const findings: Finding[] = [];

  for (const issue of issues) {
    if (!isUnresolved(issue)) {
      continue;
    }
    if (
      issue.parentKey !== undefined ||
      issue.epicKey !== undefined ||
      issue.issueLinks.length > 0 ||
      (pointing.get(issue.key)?.length ?? 0) > 0
    ) {
      continue;
    }
    findings.push({
      category: "orphaned-issue",
      issueKey: issue.key,
      summary: issue.summary,
      detail: orphanDetail(issues.length, complete, epicLinkKnown),
      severity: complete && epicLinkKnown ? "medium" : "low",
      relatedKeys: [],
    });
  }

  return findings;
}

/** The detail of an orphan finding, told apart by what is known. */
function orphanDetail(
  examined: number,
  complete: boolean,
  epicLinkKnown: boolean,
): string {
  const parts: string[] = ["The issue has no parent"];
  if (epicLinkKnown) {
    parts.push("no epic");
  }
  parts.push("and no link to another issue");
  const subject = parts.join(", ");

  const sentences = [
    complete
      ? `${subject}, and no issue points at it.`
      : `${subject}, and no issue in the listing of ${examined} issues points at it.`,
  ];
  if (!epicLinkKnown) {
    sentences.push("The epic of the issue is not known.");
  }
  return sentences.join(" ");
}

/**
 * Find the issues whose release version is missing or wrong.
 *
 * Two problems are reported: an issue names a version the project does not
 * have, so the version was renamed or removed and the issue is no longer
 * scheduled; and an issue ships in a release while the parent it rolls up to
 * carries no version at all, so the release does not add up.
 */
export function findMissingReleaseVersions(
  issues: readonly Issue[],
  versions: readonly ProjectVersion[],
): Finding[] {
  const index = indexByKey(issues);
  const knownVersions = new Set(versions.map((version) => version.name));
  const findings: Finding[] = [];

  for (const issue of issues) {
    for (const version of issue.fixVersions) {
      if (knownVersions.has(version)) {
        continue;
      }
      findings.push({
        category: "missing-release-version",
        issueKey: issue.key,
        summary: issue.summary,
        detail: `The issue names the release version "${version}", which the project does not have.`,
        severity: "medium",
        relatedKeys: [],
      });
    }

    if (issue.fixVersions.length === 0) {
      continue;
    }

    const parent = issue.parentKey !== undefined ? index.get(issue.parentKey) : undefined;
    if (parent === undefined || parent.fixVersions.length > 0) {
      continue;
    }
    findings.push({
      category: "missing-release-version",
      issueKey: issue.key,
      summary: issue.summary,
      detail: `The issue ships in ${issue.fixVersions.join(", ")} but its parent ${parent.key} carries no release version.`,
      severity: "medium",
      relatedKeys: [parent.key],
    });
  }

  return findings;
}

/** Whether a version is released, or its release date has passed. */
function isShipped(version: ProjectVersion, now: Date): boolean {
  if (version.released) {
    return true;
  }
  if (version.releaseDate === undefined) {
    return false;
  }
  const releaseDate = Date.parse(version.releaseDate);
  return !Number.isNaN(releaseDate) && releaseDate <= now.getTime();
}

/**
 * Find the blockers that have gone stale.
 *
 * A blocker is an issue that blocks another issue. A blocker that is still
 * open and has not been touched for the staleness threshold or longer is
 * reported, and it is reported as high severity when the issue it blocks
 * ships in a release that is out or already released.
 */
export function findStaleBlockers(
  issues: readonly Issue[],
  versions: readonly ProjectVersion[],
  options: RuleOptions,
): Finding[] {
  const index = indexByKey(issues);
  const shipped = new Set(
    versions.filter((version) => isShipped(version, options.now)).map((v) => v.name),
  );
  const findings: Finding[] = [];
  // Jira reports a link from both ends: the source carries the outward link
  // and the target carries the inward one. The same blocking relation is
  // therefore seen twice, and it must be reported once.
  const seen = new Set<string>();

  for (const issue of issues) {
    for (const link of issue.issueLinks) {
      const relation = blockingRelation(link.type, link.direction, issue.key, link.targetKey);
      if (relation === undefined) {
        continue;
      }

      const relationKey = `${relation.blocker}|${relation.blocked}`;
      if (seen.has(relationKey)) {
        continue;
      }
      seen.add(relationKey);

      const blocker = index.get(relation.blocker);
      const blocked = index.get(relation.blocked);
      if (blocker === undefined || blocked === undefined) {
        continue;
      }
      if (!isUnresolved(blocker)) {
        continue;
      }

      const age = daysSince(blocker.updated, options.now);
      if (age === undefined || age < options.staleDays) {
        continue;
      }

      const blocksShippedWork = blocked.fixVersions.some((version) =>
        shipped.has(version),
      );
      findings.push({
        category: "stale-blocker",
        issueKey: blocker.key,
        summary: blocker.summary,
        detail: `The issue blocks ${blocked.key} and has not been updated for ${age} days.`,
        severity: blocksShippedWork ? "high" : "medium",
        relatedKeys: [blocked.key],
      });
    }
  }

  return findings;
}

/**
 * Find the broken issue hierarchies.
 *
 * Four problems are reported: a parent that does not exist, an epic that
 * does not exist, a parent chain that loops, and a hierarchy that is deeper
 * than the depth limit. A cycle is reported once, not once per issue in it.
 *
 * When the listing of the project is not complete, an issue that is not in
 * it may still exist, so a missing parent or epic is reported as "not found
 * in the listing" and with a lower severity.
 */
export function findBrokenHierarchies(
  issues: readonly Issue[],
  options: RuleOptions & { complete?: boolean },
): Finding[] {
  const index = indexByKey(issues);
  const complete = options.complete ?? true;
  const findings: Finding[] = [];

  const missing = (
    issue: Issue,
    key: string,
    kind: "parent" | "epic",
  ): Finding => {
    if (complete) {
      return {
        category: "broken-hierarchy",
        issueKey: issue.key,
        summary: issue.summary,
        detail: `The ${kind} ${key} does not exist.`,
        severity: kind === "parent" ? "high" : "medium",
        relatedKeys: [key],
      };
    }
    return {
      category: "broken-hierarchy",
      issueKey: issue.key,
      summary: issue.summary,
      detail: `The ${kind} ${key} was not found in the listing of ${issues.length} issues, which does not cover the whole project.`,
      severity: "low",
      relatedKeys: [key],
    };
  };

  for (const issue of issues) {
    if (issue.parentKey !== undefined && !index.has(issue.parentKey)) {
      findings.push(missing(issue, issue.parentKey, "parent"));
    }

    if (issue.epicKey !== undefined && !index.has(issue.epicKey)) {
      findings.push(missing(issue, issue.epicKey, "epic"));
    }
  }

  const depthOf = (issue: Issue): number | undefined => {
    const seen = new Set<string>();
    let current = issue;
    let depth = 1;
    while (current.parentKey !== undefined) {
      if (seen.has(current.key)) {
        return undefined;
      }
      seen.add(current.key);
      const parent = index.get(current.parentKey);
      if (parent === undefined) {
        return undefined;
      }
      depth += 1;
      current = parent;
    }
    return depth;
  };

  for (const issue of issues) {
    const depth = depthOf(issue);
    if (depth !== undefined && depth > options.maxDepth) {
      findings.push({
        category: "broken-hierarchy",
        issueKey: issue.key,
        summary: issue.summary,
        detail: `The hierarchy is ${depth} levels deep, deeper than the limit of ${options.maxDepth}.`,
        severity: "medium",
        relatedKeys: [],
      });
    }
  }

  findings.push(...findHierarchyCycles(issues, index));

  return findings;
}

/**
 * Find the parent chains that loop.
 *
 * Every cycle is reported once: the issues of a cycle share one finding,
 * named by the first issue of the cycle in the order the issues were given.
 */
function findHierarchyCycles(
  issues: readonly Issue[],
  index: Map<string, Issue>,
): Finding[] {
  const reported = new Set<string>();
  const findings: Finding[] = [];

  for (const issue of issues) {
    const path: string[] = [];
    const seen = new Map<string, number>();
    let current: Issue | undefined = issue;

    while (current !== undefined) {
      const position = seen.get(current.key);
      if (position !== undefined) {
        const cycle = path.slice(position);
        const fingerprint = [...cycle].sort().join(",");
        if (!reported.has(fingerprint)) {
          reported.add(fingerprint);
          findings.push({
            category: "broken-hierarchy",
            issueKey: cycle[0],
            summary: index.get(cycle[0])?.summary ?? "",
            detail: `The parent chain loops: ${cycle.join(" -> ")} -> ${cycle[0]}.`,
            severity: "high",
            relatedKeys: cycle,
          });
        }
        break;
      }
      seen.set(current.key, path.length);
      path.push(current.key);
      current =
        current.parentKey === undefined ? undefined : index.get(current.parentKey);
    }
  }

  return findings;
}
