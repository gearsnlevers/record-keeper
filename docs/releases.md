# Releases

Status: draft for review (M3a, with what the updater of M3b and the setup check of M3c check, and the kind `block` of M3d). This page says how the kit is versioned, what a release holds, what the release manifest says and how it is built and verified, how the `Release` workflow cuts a release, why immutable releases are switched on only after the first real release, and what a repository that installs the kit can check for itself. It is not part of the protocol. The release workflow is run for real for the first time in M3e; until then it has only been tested as a file ([test/release-workflow.test.mjs](../test/release-workflow.test.mjs)) and its two programs have been run against folders of their own. It writes nothing to the default branch (the maintainer's decision of 2026-11-22, [choice 1](#choices-in-this-draft-for-you-to-decide)). The files that a release installs are on [the page of the install set](install.md).

A repository pins a released version and never a branch. `main` is work in progress; a release is the point where the maintainers say that it is safe to take. The repository takes a release through a pull request that [the updater](updater.md) opens and a maintainer merges.

## Versioning

The versions are semantic, `MAJOR.MINOR.PATCH`, and the tag of a release is the version with a `v` in front (`v1.2.3`).

| Bump | When |
| ---- | ---- |
| patch | A fix, or wording, that needs nothing from a repository. |
| minor | A new optional feature: an optional workflow or setting, a check that is new and does not fail a repository that was fine. A repository that does nothing keeps working. |
| major | Something that **a person has to do**: a new required secret or setting, a file removed or renamed in the install set, a new protocol generation. |

- **A prerelease** (`premajor` or `prerelease`) is marked as a prerelease on GitHub, and a repository on the default channel does not take it.
- **The version comes from the tags.** With no tag yet, the action that computes it starts from the version in `package.json` when that is a semantic version, and from `0.0.0` when it is not, and `premajor` gives the prerelease of the next major (its page says `4.18.0` to `5.0.0-1`). `package.json` of the kit says `0.0.0`, so the first `major` should be `v1.0.0` and the first `premajor` `v1.0.0-1` ([version-bump-action](https://github.com/gearsnlevers/version-bump-action)); that is read from the action's page and has not been run for this repository, which is why the first release starts with a dry run. **No release changes `package.json`:** it says `0.0.0` for ever, nothing in the kit reads a version from it (the manifest takes `engines.node` from it and the version from the tag), and it stays `private: true`: the kit is not published to npm.
- **A change to a rule is a new record in the kit and a new release,** never a patch in a repository ([the design](design.md#delivery-and-versions)).

## The manifest

A release has one asset, `release-manifest.json`. It is made by [tools/build-release-manifest.mjs](../tools/build-release-manifest.mjs) from `install.json` and `package.json` and from the files of the commit that is released. It holds no time, and the same files give the same bytes.

An example (the digests and sizes are those of the files of the release that it describes):

```json
{
  "commit": "5bec31d90a04d7045bb2849799f4934fe52d6351",
  "files": [
    { "kind": "managed", "path": ".github/record-keeper/record-keeper.mjs", "sha256": "…", "size": 133921, "source": "record-keeper.mjs" }
  ],
  "generations": ["g1"],
  "node": ">=22",
  "requires": { "rulesets": [{ "branch": "default", "checks": ["Records integrity"], "up-to-date": true }], "secrets": ["RECORD_KEEPER_TOKEN"], "settings": ["owners"] },
  "schema": 1,
  "tag": "v1.2.3",
  "version": "1.2.3"
}
```

| Field | What it says |
| ----- | ------------ |
| `schema` | The form of the manifest: `1`. |
| `version`, `tag` | The semantic version, and its tag, which is `v` and the version. |
| `commit` | The full id of the commit that the release is made from: 40 or 64 lower case hexadecimal digits. |
| `node` | The versions of Node.js that the programs run on: `engines.node` of `package.json`. |
| `generations` | The generations of the protocol that this release reads and writes (`install.json`). |
| `files` | Every file of the install set, **sorted by destination** (by the bytes of the path): `path` is where it goes in a repository, `source` is where it is in the kit, `kind` is `managed`, `template` or `block` ([install](install.md#managed-and-template)), `sha256` is the digest of its bytes and `size` their number. |
| `requires` | What a repository must provide: `secrets` (names), `settings` (keys of the settings file that must be set) and `rulesets` (what a ruleset on a branch requires). Copied from `install.json`. |

- **`secrets` is `["RECORD_KEEPER_TOKEN"]`.** The updater needs a secret of its own to open pull requests ([the token](updater.md#the-token)); it was added to the list with the updater (M3b), and from the first release a new required secret makes a release a major one. The setup check ([the setup check](setup-check.md)) adds no secret: it is told only whether this one is set.
- **The bytes are fixed:** keys in the order of their bytes at every depth, two spaces of indentation, line feeds, one line feed at the end, no time and no machine name. A manifest that says the right things in another form does not verify.
- **A file is hashed as it is.** A carriage return, a byte order mark, an empty file and a name with a space are what they are. `.gitattributes` keeps git from changing the line endings of the files of the install set.
- **Nothing is read that is not in the release.** A source that is missing, a source that is a symbolic link (or has one on its path), a destination twice (also in other capitals), a destination outside `.github/`, `docs/decisions/` and the three files `.claude/skills/record-a-decision/SKILL.md`, `AGENTS.md` and `CLAUDE.md`, a `block` anywhere but `AGENTS.md` (and `AGENTS.md` as anything but a block), an absolute path or one with `..`, and a `kind` that is not one of the three are refused with a message that names the entry ([install](install.md#installjson)).

**Building and verifying.**

```sh
node tools/build-release-manifest.mjs --version 1.2.3 --tag v1.2.3 --commit <id> --out release-manifest.json
node tools/build-release-manifest.mjs --verify release-manifest.json
python3 reference/verify_manifest.py --verify release-manifest.json
```

`--verify` recomputes every digest and size from the files of the working tree and compares them with the manifest, and finds a file that was changed, resized, replaced by a link or deleted, a file that the manifest lacks or that `install.json` does not list, another `node`, `generations` or `requires`, and a text that is not in the canonical form. `--root <folder>` names the folder of the files, which is the working directory by default. The exit status is 0 when it verifies, 1 when something is refused or does not verify, 2 for wrong usage.

**A second implementation.** `reference/verify_manifest.py` is written in Python from this page and shares no code with the Node program. It verifies a manifest, and with `--build` it writes the manifest it would build; a test runs the two against each other on odd files (a file with carriage returns, an empty one, one with a byte order mark, binary bytes, a name with a space) and on this repository, and compares the bytes. The release workflow runs both verifiers.

## The release workflow

`Release` (`.github/workflows/release.yml`) is started by hand (`workflow_dispatch`) and nothing else starts it. It takes two inputs: `release-type`, one of `prerelease`, `premajor`, `patch`, `minor` and `major`, and `dry-run`, a boolean that is off by default. Its token has `contents: write` and nothing else, one run at a time holds the concurrency group `release`, and a run that has started is never cancelled, because it may be half way through its writes. Its release actions are `gearsnlevers/version-bump-action`, `gearsnlevers/release-preflight-action` and, when a key is set, `gearsnlevers/ai-changelog-action`; they and the actions of GitHub are each pinned to a commit with the version in a comment.

**It writes nothing to the default branch.** No commit, no push of a branch, no file created through the API. The ruleset of the default branch requires a pull request and the token of the workflow has no bypass, so a commit of the changelog and the version would have been refused at the first release; the maintainer decided on 2026-11-22 that there is none. The one thing the workflow writes to the repository is the tag, and then the release:

- **The tag** is on the commit that the run started from, which is the commit that the manifest names.
- **The notes** of the release are the changelog: they are the body of the release, and `CHANGELOG.md` says so and points to the releases ([choice 1](#choices-in-this-draft-for-you-to-decide)).
- **The version** comes from the tags. `package.json` stays `0.0.0`.
- **The manifest** is the only asset of the release.

1. **Require the default branch** for a real release. A dry run may run from any branch.
2. **`npm test`** and **`record-keeper.mjs validate docs/decisions`**, as the pipeline of every pull request does.
3. **The next version** (`version-bump-action`), from the tags and the type of the release, and a **preflight** (`release-preflight-action`): the tag does not exist yet. The preflight is asked for no check of the version of `package.json`, nor of npm: nothing writes the first, and the kit is not on the second.
4. **The release notes.** With the repository secret `LLM_API_KEY` the AI changelog (`ai-changelog-action`) writes them to `RELEASE_NOTES.md`; it works on a file of its own, `release-changelog-work.md`, which is not committed, and not on `CHANGELOG.md`. Without the key GitHub generates the notes (from the previous tag to the commit of the run), and an empty body becomes the line `Release v1.2.3.`.
5. **Check that the files are the files of the commit:** `git diff --quiet HEAD` must find nothing, so that no step has changed a file that the tag will not hold.
6. **Check the install set:** build the manifest for the commit that the run started from and verify it, so that a refusal (a missing source, a link, a path that is not allowed) stops the run before the tag and the release are written.
7. **Build the manifest for that commit and verify it,** with both programs (Node and Python).
8. **Tag** the commit with an annotated tag and push that tag and nothing else (`refs/tags/v1.2.3`; a real release only). It first checks that the manifest names the commit that is to be tagged, and it sets the name and the e-mail of the tagger, because no other step does. It is idempotent for the same commit: a tag that is there already on the commit that is released is left alone. A tag that is there on another commit stops the run with an error.
9. **Create a draft release** with the notes (a prerelease when the version is one), **upload the manifest** to the draft and check that the draft holds a file of that name and size, and then **publish** the release (a real release only). A draft that a failed run left behind is deleted and made again. A release that is published is never touched: creating it again fails.
10. **A summary** of the run is always written, with the type, the base version, the new version, the tag, whether it is a prerelease, where the notes come from and whether it was a dry run.

**The dry run** does steps 2 to 7: it tags nothing and publishes nothing, writes nothing to the repository, and uploads `release-manifest.json` and `RELEASE_NOTES.md` as the artifact `release-dry-run`. The manifest it makes names the commit that the run started from. From the default branch that is the commit that a real release would tag, so the manifest of a dry run is the one that the real run makes, as long as the branch has not moved and no tag has been made in between; from another branch it names the commit of that branch. The tests of the workflow state, line by line, that every step that writes (the tag, the draft, the upload, the publication) is guarded by the dry run, that no step commits or pushes a branch or writes a file or a reference through the API, and that the release is published only after the manifest is uploaded.

**The first release.**

1. Run it with `major` and the dry run on. Read the summary: it must say `v1.0.0`. Read the notes and the manifest.
2. Optional rehearsal: run `premajor` for real (`v1.0.0-1`, a prerelease). It can be deleted with its tag only while the setting of step 3 is off, and it has to be deleted before step 3.
3. Switch on immutable releases ([below](#immutable-releases)).
4. Run `major` with the dry run off, and check the release with `gh release verify` ([below](#immutable-releases)).

**Before the first real release.** These are not done by anything in this repository. All four held for the release of `v1.0.0` on 2026-11-22: the token of the workflow made the tag and the release, and the default branch was not changed.

- The ruleset of the default branch needs no change and the workflow needs no bypass: it writes nothing there. **A bypass for the workflow should not be given.**
- The setting of the organisation for the permissions of the workflow token allows `contents: write`; the workflow asks for it, for the tag and the release.
- Nothing refuses the tag. The repository has two rulesets, both on branches (read through the API on 2026-11-22), so none refuses the creation of a tag by the token of the workflow. A ruleset on tags that is added later has to let the workflow create `v*`. The push of the tag of `v1.0.0` by the token of the workflow worked on 2026-11-22.
- The audit has nothing to take for a breach: a release adds no commit to the default branch.

**If it fails midway.** A run that stopped before the tag changed nothing in the repository: run it again. A run that stopped after the tag and before the release was published has put the tag there, and the version is computed from the tags, so a run again computes the version after it and leaves the tag of the stopped run without a release. A dry run shows the version before it is cut. To make the same release again, a person deletes the tag, and the next run, which computes the same version, deletes the draft that is left and makes it again (the draft that is left is not tried; a release that was published, with the setting off, was deleted with its tag by `gh release delete <tag> --cleanup-tag` and made again by the next run on 2026-11-22, with the same version and the same manifest); or the person publishes the draft by hand when the manifest is on it. A tag on the wrong commit is deleted by a person before the run is repeated. A tag of a published release cannot be moved once releases are immutable ([below](#immutable-releases)), and a draft is not published.

**Secrets.** None is required. `LLM_API_KEY` switches the notes to the AI changelog. The workflow uses the token that GitHub gives each run, which writes the tag and the release and nothing else; no second secret, and no token of a bot that may bypass a ruleset.

## Immutable releases

GitHub can make the releases of a repository immutable: "where the assets and associated Git tag cannot be changed after publication". "Git tags cannot be moved", and "release assets cannot be modified or deleted"; the title, the notes and the status as a prerelease can still be edited. GitHub recommends creating the release as a draft, attaching all assets, and then publishing it, "to ensure that all assets are in place before the release becomes immutable" ([immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)). That is the order of step 9.

**The maintainer switches them on before the first real release,** after the dry run and the rehearsal, if there is one (in the settings of the repository; `PUT /repos/{owner}/{repo}/immutable-releases` does the same and a `GET` of it reads the setting):

- A release that is published while the setting is off is not immutable and has no attestation, and switching the setting on later covers only the releases after it. `v1.0.0` was first published with the setting off, and `gh release verify v1.0.0` said `no attestations for tag v1.0.0`. It was deleted with its tag, the setting was switched on, and the same release was made again on 2026-11-22; its manifest is byte for byte the first one. An earlier text of this page said to switch the setting on after the first release, so that a botched first release could be deleted and made again; it cost the first release its attestation, and the first release is the one that the first adoption of a consuming repository is made from.
- A published immutable release keeps its assets and its tag as they are: the tag cannot be moved, and, as the page describes it, once the release is deleted the name of the tag cannot be used again. A botched release then costs a version number. The dry run shows everything but the writes of the tag, the draft, the upload and the publication, and those did their work on 2026-11-22.
- A rehearsal with `premajor` is possible only before the setting is switched on, and it has to be deleted with its tag before the setting is.
- The workflow does not depend on the setting: it makes a draft, uploads and publishes whether the repository is immutable or not.

**What GitHub says a consumer can check.** An immutable release has a release attestation, "a cryptographically verifiable record of a release containing the release tag, commit SHA, and release assets" ([immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)). GitHub's page on the integrity of a release gives two commands of the GitHub CLI: `gh release verify <tag>`, which checks that the release exists and is immutable, and `gh release verify-asset <tag> <file>`, which checks that a local file is an exact match of a release asset ([verifying the integrity of a release](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verifying-the-integrity-of-a-release)).

**Tried on `v1.0.0`, 2026-11-22.** The setting is available for a public repository of an organisation on the Free plan: the `PUT` returned and a `GET` read `enabled: true`. With the setting on, the release is immutable (`isImmutable` of `gh release view`), and with GitHub CLI 2.97.0 `gh release verify v1.0.0` prints `Release v1.0.0 verified!` after it loads the attestation from the GitHub API, and `gh release verify-asset v1.0.0 release-manifest.json` prints `Verification succeeded` for the downloaded manifest. This is the claim of [the design](design.md#delivery-and-versions) that releases are attested, checked on one release. Without the setting, the first release had no attestation. Not known: the oldest version of the GitHub CLI that has the two commands (the page does not say), and what the setting does for a private repository or another plan. No program of the kit calls the two commands; a person does.

## What a repository can verify

| Check | How | What it shows | Status |
| ----- | --- | ------------- | ------ |
| The files are the release's | `--verify` of the manifest, against the files that were downloaded for the tag; the updater does the same for every file it downloads, at the commit of the tag, by the SHA-256 and the size of the manifest, and writes nothing when one does not match | each file is what the release holds, byte for byte | Tried on folders of their own and on this repository, and by the updater against a local server ([the updater](updater.md#what-is-verified-and-what-is-not)); not against GitHub. |
| The release is of that commit | `git rev-parse <tag>^{commit}` equals `commit` of the manifest; the updater asks the API for the commit that the tag points at, through an annotated tag, and refuses a manifest that names another | the manifest is of the commit that the tag names | Tried by the updater against a local server. The tag of `v1.0.0` is an annotated tag that points at the commit its manifest names (read through the API on 2026-11-22); the updater has not read it yet. |
| The release was not changed after it was published | `gh release verify <tag>` and `gh release verify-asset <tag> release-manifest.json` | the release is immutable, and the manifest is the asset that was published | Tried on `v1.0.0` with GitHub CLI 2.97.0: both pass ([above](#immutable-releases)). |
| The installed files are the release's | [the setup check](setup-check.md) (M3c) compares the installed managed files with the manifest of the pinned release, by SHA-256 and size, on every run, and says `managed-differs` | a managed file was not edited in the repository | Tried against a local server and temporary repositories; not against GitHub, and not on a real release. |

What the manifest does not show: that the code is right, or that nobody with the rights to the repository of the kit made a release that does something else. The digests are of the files of the release, and the manifest is an asset of the same release, so the manifest alone protects against a download that went wrong and not against a release that was made to be wrong. The immutability and the attestation are what make a swap after publication visible, and the owners' approval of the update pull request, which shows the diff of every managed file, is what makes a bad release visible before it is used.

## What this page does not do

- **It does not publish anything.** The workflow does, run by the maintainer; the first release, `v1.0.0` of 2026-11-22, was M3e.
- **It does not say how the updater reads a release.** [The updater](updater.md) does: it reads the manifest as untrusted data, and a manifest that it does not read is a refusal and not a guess.
- **It does not publish the kit to npm.** The package is private.

## Choices in this draft for you to decide

1. **The workflow writes nothing to the default branch; the changelog is the notes of the release.** The maintainer decided this on 2026-11-22. An earlier draft committed `CHANGELOG.md` and `package.json` as `chore: release v1.2.3`, as the workflow of the action repositories does; the ruleset of the default branch requires a pull request and the token of the workflow has no bypass, so that push would have been refused at the first real release. The alternatives, not taken: a bypass for the workflow (a standing hole in the ruleset for a bot, and a commit on the default branch that the audit has to excuse), a token of its own (a second secret to keep), and a pull request for a release commit (the release would wait for a person, and the tag would have to go on a commit that exists only after the merge). The cost: a clone of the kit has no changelog, only a file that points to the releases (`CHANGELOG.md`), and the notes of a release can still be edited on GitHub after it is published, which a committed file would not allow.
2. **`package.json` stays at `0.0.0` and `private: true`.** With tags the version comes from the tags, and nothing in the kit reads it from the file; the manifest takes `engines.node` from it and nothing else. The cost: the file never says the version of the kit. The alternative is a commit of the version, which is choice 1.
3. **`tools/update-changelog.mjs` and its test are removed.** They wrote the notes that GitHub generates into `CHANGELOG.md`, and nothing else needs them. The alternative was to keep them, unused. An empty body of generated notes still becomes the line `Release v1.2.3.` in the workflow: a release with no words says nothing, and a refusal would stop a release for a quirk of the notes that GitHub generates.
4. **The manifest is the only asset of a release,** and the notes are its body. The alternative is to attach the notes as a second asset (`RELEASE_NOTES.md`) for people who download releases. The updater and the setup check find the manifest by its name and would not mind a second file, but the updater already shows the body of the release in the pull request it opens, so the second file would say the same thing in a second place, and a second asset is a second file for `gh release verify-asset` and for a person to check.
5. **The manifest verifier is run by Python as well as by Node in the release itself,** so that a disagreement of the two stops a release before the tag. It makes the release job need `python3`, which the runner has.
6. **The upload is checked by the size of the asset on the draft,** read from the list of releases of the API (a draft cannot be read by its tag). It checks that the file is there and whole, not that it is the same file.
7. **The manifest names `node` as the range of `engines`,** not a version, because that is what the programs need. The updater can compare it with the Node of the workflow.
8. **`commit` must be a full id,** and `tag` must be `v` and the version: a manifest with a short id or another tag is refused when built and does not verify.
9. **A dry run of a branch other than the default** is allowed, and its manifest names that branch's commit. The summary says it was a dry run.
10. **The AI changelog is optional,** as the workflow of the action repositories makes it. The kit's own release notes are then the ones that GitHub generates from the titles of the pull requests.
11. **Immutable releases are switched on before the first real release,** after the dry run. The maintainer decided this on 2026-11-22, after the first release had been published with the setting off and had no attestation (see [above](#immutable-releases)). The alternative, which this page said before: switch the setting on after the first release, so that a botched first release can be deleted and made again. Its cost was the attestation of the first release, which is the release that a consuming repository is first adopted from. The cost of the choice made: a botched first release costs a version number, and a rehearsal with `premajor` has to be deleted before the setting is switched on.
11. **The tests of the workflow are a lint of its text,** not a run of it. The first run for real shows what the lint could not.
12. **The AI changelog works on a file of its own, `release-changelog-work.md`,** and a step checks that no file of the commit has changed before the manifest is built. Without the first, the action would rewrite `CHANGELOG.md` in the working tree, and without the second nothing would say that a step had; the manifest is of the commit, and a file that differs from it would make the manifest say what the tag does not hold. The cost is one input of an action that has not run for this repository (its code creates the file when it is not there), and one more step that can stop a release. The alternative is to leave both out: the changes would be thrown away with the runner and nothing would notice.
13. **The tag step checks that the manifest names the commit that it tags, and says the commit it tags.** `git tag -a <tag> <commit>` and `git push origin refs/tags/<tag>`: no tag that might land on another commit than the manifest names, and no push that might mean a branch. The alternative is the shorter `git tag -a` and `git push origin <tag>` of the earlier draft, which tag `HEAD` and push whatever ref has that name.
