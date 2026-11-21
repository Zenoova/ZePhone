// Decides the next release from the Conventional Commits made since the last release tag, and writes its notes.
//
//   node scripts/next-version.mjs                 print the decision as JSON
//   node scripts/next-version.mjs --notes out.md  also write the release notes to out.md
//   node scripts/next-version.mjs --changelog CHANGELOG.md   also add the release to the changelog
//
//   feat                       -> minor      fix, perf               -> patch
//   a breaking change (`!` or a `BREAKING CHANGE:` footer) -> major   (minor while the version is still 0.y.z)
//   docs, chore, ci, test, build, refactor, style, revert -> nothing to release on their own
//
// With no release tag yet, the first release is the version the files already carry.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const SUBJECT = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const SECTIONS = [
  ["breaking", "Breaking changes"],
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
];

/** `{ type, scope, breaking, description }` of a commit message, or null when it is not a conventional one. */
export function parseCommit(subject, body = "") {
  const m = SUBJECT.exec(subject.trim());
  if (!m) return null;
  const [, type, scope, bang, description] = m;
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body);
  return { type: type.toLowerCase(), scope: scope ?? null, breaking, description: description.trim() };
}

/** The bump a list of parsed commits calls for: "major", "minor", "patch" or null. */
export function bumpFor(commits, previousMajor) {
  let bump = null;
  for (const c of commits) {
    if (c.breaking) return previousMajor === 0 ? "minor" : "major";
    if (c.type === "feat") bump = "minor";
    else if ((c.type === "fix" || c.type === "perf") && bump === null) bump = "patch";
  }
  return bump;
}

export function bumpVersion(version, bump) {
  const [major, minor, patch] = SEMVER.exec(version).slice(1).map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** The decision: { previous, version, bump, release }. `commits` are parsed ({type, scope, breaking, ...}). */
export function decide({ previous, baseline, commits }) {
  if (!previous) return { previous: null, version: baseline, bump: "initial", release: true };
  const bump = bumpFor(commits, Number(SEMVER.exec(previous)[1]));
  if (!bump) return { previous, version: previous, bump: null, release: false };
  return { previous, version: bumpVersion(previous, bump), bump, release: true };
}

/** Markdown notes of a release: the commits that matter, by section. */
export function renderNotes({ version, previous, commits, repository = "Zenoova/ZePhone" }) {
  if (!previous) return `First release of ZePhone, version ${version}.\n`;
  const lines = [];
  for (const [key, title] of SECTIONS) {
    const items = commits.filter((c) => (key === "breaking" ? c.breaking : !c.breaking && c.type === key));
    if (items.length === 0) continue;
    lines.push(`### ${title}`, "");
    for (const c of items) {
      const scope = c.scope ? `**${c.scope}:** ` : "";
      lines.push(`- ${scope}${c.description}${c.hash ? ` (\`${c.hash.slice(0, 7)}\`)` : ""}`);
    }
    lines.push("");
  }
  lines.push(`**Full changelog**: https://github.com/${repository}/compare/v${previous}...v${version}`, "");
  return lines.join("\n");
}

/** `existing` CHANGELOG.md text with this release's section added right under the title (newest first). */
export function withChangelogEntry(existing, { version, date, notes }) {
  const title = "# Changelog\n\n";
  const body = existing.startsWith("# Changelog") ? existing.replace(/^# Changelog\n+/, "") : existing;
  return `${title}## v${version} (${date})\n\n${notes.trim()}\n\n${body}`.trimEnd() + "\n";
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** The newest `vX.Y.Z` tag reachable from HEAD, as `X.Y.Z`, or null. */
function lastReleaseVersion() {
  try {
    const tag = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*.[0-9]*.[0-9]*");
    return SEMVER.test(tag.slice(1)) ? tag.slice(1) : null;
  } catch {
    return null;
  }
}

function commitsSince(previous) {
  const range = previous ? [`v${previous}..HEAD`] : [];
  const raw = git("log", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", ...range);
  return raw
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, subject, body = ""] = entry.split("\x1f");
      const parsed = parseCommit(subject, body);
      return parsed ? { ...parsed, hash } : null;
    })
    .filter(Boolean);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const baseline = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const previous = lastReleaseVersion();
  const commits = previous ? commitsSince(previous) : [];
  const decision = decide({ previous, baseline, commits });
  const notesAt = process.argv.indexOf("--notes");
  if (notesAt > 0) {
    writeFileSync(process.argv[notesAt + 1], renderNotes({ version: decision.version, previous, commits }));
  }
  const changelogAt = process.argv.indexOf("--changelog");
  if (changelogAt > 0 && decision.release) {
    const file = process.argv[changelogAt + 1];
    let existing = "";
    try {
      existing = readFileSync(file, "utf8");
    } catch {
      /* a new changelog */
    }
    const notes = renderNotes({ version: decision.version, previous, commits });
    const date = new Date().toISOString().slice(0, 10);
    writeFileSync(file, withChangelogEntry(existing, { version: decision.version, date, notes }));
  }
  console.log(JSON.stringify(decision));
}
