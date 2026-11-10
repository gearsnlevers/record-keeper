# Reference implementations and test generators

This folder is how the kit is checked against something other than itself. It is not part of the protocol, it is not delivered to a repository that uses the kit, and `npm test` does not run it. The library (`record-keeper.mjs`) needs none of it; whoever changes a rule or a fixture does.

## What is here

- **A second implementation of each page.** Python (`*_ref.py`, `g1.py`) and, for two pages, Node (`g1.mjs`, `validate_ref2.mjs`). Each is written from the page and shares no code with `record-keeper.mjs`. The page decides: when a reference and the library disagree, one of them is wrong about the page, and the page is read again.
- **Builders** (`build_*.py`). A builder writes a fixture: the cases are written by hand together with the answer the author expects, the reference computes the answer, and the builder stops when the two differ. So a case shows what it was written to show, and a fixture cannot drift from the reference without someone seeing it.
- **Fuzz** (`fuzz/`). Random inputs go through a reference and through the library, and a comparer lists every difference. A run that finds no difference proves little until the same run has been shown to find one, for example against the library as it was before a fix.
- **Mutation scripts** (`fuzz/mutate_*.py`, `mutate_g1.py`). One line of the library at a time is changed in a copy, and the tests must fail. A mutant that survives is a missing test, or it is equivalent to the original and is said to be.

| Page | Reference | Builder | Fixtures | Fuzz |
| ---- | --------- | ------- | -------- | ---- |
| [generation-g1](../docs/generation-g1.md) | `g1.py`, `g1.mjs` | `build_vectors.py` | `test/vectors/g1` | `fuzz/g1_mutants.py`, `g1_run_py.py`, `g1_run_node.mjs`, `g1_compare.py`; `mutate_g1.py` |
| [record-format](../docs/record-format.md) | `validate_ref.py`, `validate_ref2.mjs` | `build_cases.py` | `test/fixtures/validate` | `fuzz/validate_fuzz.py`, `validate_compare_ref2.mjs`, `validate_compare.mjs`; `run_cases.mjs` |
| [reading-a-commit](../docs/reading-a-commit.md) | `commit_ref.py` (repositories built with `commit_lib.py`) | `build_commit_cases.py` | `test/fixtures/commit` | `fuzz/commit_fuzz.py`, `commit_compare.mjs`, `commit_equiv.mjs` |
| [settings](../docs/settings.md) | `config_ref.py` | `build_config_cases.py` | `test/fixtures/config` | `fuzz/config_fuzz.py`, `config_compare.mjs`, `config_tree_fuzz.py`, `config_tree_compare.mjs`, `config_oracle.*` |
| [applies-to](../docs/applies-to.md) | `check_ref.glob_regex` | `build_applies_vectors.py` | `test/fixtures/applies` | |
| [approvals](../docs/approvals.md) | `approval_ref.py` | `build_approval_cases.py` | `test/fixtures/approval` | `fuzz/approval_fuzz.py`, `approval_compare.mjs` |
| [checking-a-change](../docs/checking-a-change.md), [errata-and-deviations](../docs/errata-and-deviations.md) | `check_ref.py` | `build_change_cases.py` | `test/fixtures/change` | `fuzz/change_fuzz.py`, `change_ref_run.py`, `change_compare.mjs`, `change_batch.sh`; `fuzz/errata_fuzz.py`, `errata_ref_run.py`, `errata_compare.mjs`, `errata_batch.sh` |
| [audit](../docs/audit.md) | `audit_ref.py` (with `audit_lib.py` for the histories) | `build_audit_cases.py` | `test/fixtures/audit` | `fuzz/audit_fuzz.py`, `audit_ref_run.py`, `audit_compare.mjs`, `audit_batch.sh` |

## The rules for changing any of it

1. **The page first.** A rule changes in its page, then in the reference, then in the library. A reference is never edited to make a fixture or the library pass without the page being read.
2. **Never edit a generated fixture by hand.** Change the builder and rebuild. `check-fixtures.sh` rebuilds all of them and compares them with the committed files byte for byte; a pull request that changes a builder or a fixture should leave it printing `same` for every line.
3. **The generation g1 is frozen once record 0001 is accepted.** `build_vectors.py` and `g1.py` then change only to add vectors that move no existing answer.
4. **The kit names no deployment.** A script that wants a corpus of real records takes the folders as arguments (`g1_mutants.py`, `run_vectors.mjs`) and does not know whose they are.

## Running it

Needs Python 3.9 or later, git and Node 22 or later. `fuzz/config_oracle.py` also needs PyYAML and Ruby, and for its third reader a folder where `npm install yaml` was run, named in `YAML_DIR`, because it asks three real YAML readers what a settings file means.

```sh
reference/check-fixtures.sh                       # rebuild every fixture and compare; a few minutes

# a fixture builder writes to the path it is given; build into a scratch folder, not into test/
python3 reference/build_change_cases.py /tmp/cases.json && cmp /tmp/cases.json test/fixtures/change/cases.json

# the second implementation of g1 against the vectors, and against g1.py on some folders of records
node reference/run_vectors.mjs test/vectors/g1 [folder-of-records ...]
node reference/run_cases.mjs test/fixtures/validate reference/validate_ref2.mjs

# a differential fuzz of check-pr: 4000 random pull requests, 4 workers, seed 7
reference/fuzz/change_batch.sh /tmp/change-fuzz 4000 7 4 && cat /tmp/change-fuzz/result.txt

# mutation testing of the lines of record-keeper.mjs that differ from a commit
python3 reference/fuzz/mutate_diff.py . 4 <base commit>
```

`fuzz/mutate_change.py` mutates every line of the part of the library that checks a change, `fuzz/mutate_pr.py` every line of `check-pull-request.mjs` and `mutate_pr2.py` only the lines that differ from a commit, and `fuzz/mutate_note_case.py` is an example of a hand-written list of mutants for one change. The batch scripts and the other fuzz scripts say how they are called in their first lines.

The builders delete the folder they are given (`build_vectors.py`, `build_cases.py`), so they are never pointed at a folder under `test/` that holds a hand-written `README.md`.
