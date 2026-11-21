import assert from "node:assert/strict";
import { test } from "node:test";

import { bumpFor, bumpVersion, decide, parseCommit, renderNotes, withChangelogEntry } from "./next-version.mjs";

const c = (subject, body = "") => parseCommit(subject, body);

test("reads a conventional commit, with a scope and a breaking mark", () => {
  assert.deepEqual(c("feat(calls): add transfer"), { type: "feat", scope: "calls", breaking: false, description: "add transfer" });
  assert.equal(c("fix: a bug").scope, null);
  assert.equal(c("feat(api)!: drop v1").breaking, true);
  assert.equal(c("refactor: x", "details\n\nBREAKING CHANGE: the config moved").breaking, true);
  assert.equal(c("Merge branch 'main'"), null);
  assert.equal(c("update stuff"), null);
});

test("feat is minor, fix and perf are patch, the biggest wins", () => {
  assert.equal(bumpFor([c("fix: a"), c("feat: b"), c("fix: c")], 1), "minor");
  assert.equal(bumpFor([c("fix: a"), c("perf: b")], 1), "patch");
  assert.equal(bumpFor([c("docs: a"), c("chore: b"), c("ci: c"), c("test: d")], 1), null);
});

test("a breaking change is major, but only minor before 1.0", () => {
  assert.equal(bumpFor([c("feat!: new engine")], 1), "major");
  assert.equal(bumpFor([c("fix: a"), c("feat!: new engine")], 2), "major");
  assert.equal(bumpFor([c("feat!: new engine")], 0), "minor");
});

test("bumping a version resets what is below it", () => {
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
});

test("the first release is the version of the files, and nothing releases without a releasable commit", () => {
  assert.deepEqual(decide({ previous: null, baseline: "0.1.0", commits: [] }), {
    previous: null,
    version: "0.1.0",
    bump: "initial",
    release: true,
  });
  assert.deepEqual(decide({ previous: "0.1.0", baseline: "0.1.0", commits: [c("docs: readme")] }), {
    previous: "0.1.0",
    version: "0.1.0",
    bump: null,
    release: false,
  });
  assert.equal(decide({ previous: "0.1.0", baseline: "0.1.0", commits: [c("feat: x")] }).version, "0.2.0");
  assert.equal(decide({ previous: "0.2.0", baseline: "0.1.0", commits: [c("fix: x")] }).version, "0.2.1");
});

test("the notes group the commits that matter and link the comparison", () => {
  const commits = [
    { ...c("feat(calls): add transfer"), hash: "abcdef1234567" },
    { ...c("fix: crash on hang up"), hash: "1234567abcdef" },
    { ...c("feat(api)!: drop v1"), hash: "ffffffffffff" },
    { ...c("docs: readme"), hash: "0000000000000" },
  ];
  const notes = renderNotes({ version: "1.0.0", previous: "0.9.0", commits });
  assert.match(notes, /### Breaking changes\n\n- \*\*api:\*\* drop v1 \(`fffffff`\)/);
  assert.match(notes, /### Features\n\n- \*\*calls:\*\* add transfer \(`abcdef1`\)/);
  assert.match(notes, /### Fixes\n\n- crash on hang up/);
  assert.doesNotMatch(notes, /readme/);
  assert.match(notes, /compare\/v0\.9\.0\.\.\.v1\.0\.0/);
});

test("the changelog gets the newest release right under its title", () => {
  const first = withChangelogEntry("", { version: "0.1.0", date: "2026-01-01", notes: "First release.\n" });
  assert.equal(first, "# Changelog\n\n## v0.1.0 (2026-01-01)\n\nFirst release.\n");
  const second = withChangelogEntry(first, { version: "0.2.0", date: "2026-02-01", notes: "### Features\n\n- x\n" });
  assert.match(second, /^# Changelog\n\n## v0\.2\.0 \(2026-02-01\)\n\n### Features\n\n- x\n\n## v0\.1\.0/);
});
