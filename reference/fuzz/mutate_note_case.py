"""Mutation test of the lines that the note case adds to record-keeper.mjs (docs/errata-and-deviations.md, "A record that does not verify").
Each mutant is one replacement in a copy of the repository; the tests of the change and of the audit must fail on it.
Usage: mutate_note_case.py <repo_dir> <workers> <out.txt>"""
import concurrent.futures, os, shutil, subprocess, sys, tempfile
repo, workers, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
FILE = 'record-keeper.mjs'
src = open(os.path.join(repo, FILE)).read()

LACKS = "const lacksSeal = (record) => record.claims && !record.sealed && (record.check.reason === 'not-sealed' || record.check.reason === 'mismatch');"
LOOP = "if (!lacksSeal(record) || !after.has(name) || additionOf(record, after.get(name)) !== 'deviation') continue;"
JUDGE = "judgeDeviation(record, after.get(name), { repo, base: base.empty ? null : base.commit, cases, needs, assume })"
PUSH = "problems.push({ file: name, ...problem });\n  }\n  const shared"
VALID = "if ((sealedKept.has(problem.file) || noted.has(problem.file)) && CONTENT_RULES.has(problem.rule)) {"
STATE = "if (!knownState.has(identity(problem)) || !(sameEntry(problem.file) || additions.get(problem.file) === 'deviation')) problems.push(problem);"

MUTANTS = [
    (LACKS, LACKS.replace('record.claims && ', ''), 'lacksSeal: drop claims'),
    (LACKS, LACKS.replace('!record.sealed && ', ''), 'lacksSeal: drop !sealed'),
    (LACKS, LACKS.replace("=== 'not-sealed'", "!== 'not-sealed'"), "lacksSeal: not-sealed flipped"),
    (LACKS, LACKS.replace("=== 'mismatch'", "!== 'mismatch'"), 'lacksSeal: mismatch flipped'),
    (LACKS, LACKS.replace(" || record.check.reason === 'mismatch'", ''), 'lacksSeal: no mismatch'),
    (LACKS, LACKS.replace("record.check.reason === 'not-sealed' || ", ''), 'lacksSeal: no not-sealed'),
    (LACKS, LACKS.replace("record.check.reason === 'mismatch')", "record.check.reason === 'mismatch' || record.check.reason === 'unknown-generation')"), 'lacksSeal: also unknown generation'),
    (LACKS, LACKS.replace("record.check.reason === 'mismatch')", "record.check.reason === 'mismatch' || record.check.reason === 'malformed')"), 'lacksSeal: also malformed'),
    (LACKS, LACKS.replace('!record.sealed && (', '!record.sealed || ('), 'lacksSeal: && to ||'),
    (LACKS, LACKS.replace('record.claims && !record.sealed', 'record.claims || !record.sealed'), 'lacksSeal: claims || !sealed'),
    (LOOP, LOOP.replace('!lacksSeal', 'lacksSeal'), 'loop: lacksSeal negated'),
    (LOOP, LOOP.replace('!after.has(name)', 'after.has(name)'), 'loop: after.has negated'),
    (LOOP, LOOP.replace("!== 'deviation'", "=== 'deviation'"), 'loop: addition flipped'),
    (LOOP, LOOP.replace("!== 'deviation'", "!== 'erratum'"), 'loop: erratum instead of deviation'),
    (LOOP, LOOP.replace(' || !after.has(name)', ''), 'loop: no after.has'),
    ('    noted.add(name);\n', '', 'loop: no noted.add'),
    ("    additions.set(name, 'deviation');\n    for (const problem of judgeDeviation(record", "    for (const problem of judgeDeviation(record", 'loop: no additions.set'),
    (JUDGE, JUDGE.replace('base: base.empty ? null : base.commit', 'base: null'), 'judge: base null'),
    (JUDGE, JUDGE.replace(', cases,', ','), 'judge: no cases'),
    (JUDGE, JUDGE.replace(', assume }', ' }'), 'judge: no assume'),
    (JUDGE, JUDGE.replace(', needs,', ','), 'judge: no needs'),
    (JUDGE, JUDGE.replace('{ repo, ', '{ '), 'judge: no repo'),
    (JUDGE + ') problems.push({ file: name, ...problem });', JUDGE + ') problems.push({ file: name, ...problem, rule: problem.rule });', 'loop: same push (equivalent)'),
    (JUDGE + ') problems.push({ file: name, ...problem });', JUDGE + ') void problem;', 'loop: problems dropped'),
    (VALID, VALID.replace(' || noted.has(problem.file)', ''), 'validate: no noted'),
    (VALID, VALID.replace('sealedKept.has(problem.file) || ', ''), 'validate: only noted'),
    (VALID, VALID.replace(' || noted.has(problem.file)', ' || true'), 'validate: every record'),
    (STATE, STATE.replace("=== 'deviation'", "!== 'deviation'"), 'state: deviation flipped'),
    (STATE, STATE.replace("=== 'deviation'", "=== 'erratum'"), 'state: erratum instead'),
    (STATE, STATE.replace(' || additions.get(problem.file) === \'deviation\'', ''), 'state: no deviation clause'),
    (STATE, STATE.replace('sameEntry(problem.file) || additions', 'sameEntry(problem.file) && additions'), 'state: || to &&'),
    (STATE, STATE.replace('!(sameEntry', '(sameEntry'), 'state: negation dropped'),
]

tests = ['test/change.test.mjs', 'test/audit.test.mjs']


def run(index, mutant):
    old, new, label = mutant
    if src.count(old) != 1:
        return index, label, 'NOT APPLIED (count %d)' % src.count(old)
    if old == new:
        return index, label, 'NOT APPLIED (no change)'
    work = tempfile.mkdtemp(prefix='mut-note-', dir=os.path.dirname(os.path.abspath(out)))
    try:
        for entry in os.listdir(repo):
            if entry in ('.git', 'node_modules'): continue
            target = os.path.join(work, entry)
            (shutil.copytree if os.path.isdir(os.path.join(repo, entry)) else shutil.copy)(os.path.join(repo, entry), target)
        text = src.replace(old, new, 1)
        open(os.path.join(work, FILE), 'w').write(text)
        result = subprocess.run(['node', '--test', *tests], cwd=work, capture_output=True, text=True, timeout=900)
        return index, label, 'killed' if result.returncode != 0 else 'SURVIVED'
    finally:
        shutil.rmtree(work, ignore_errors=True)


with concurrent.futures.ThreadPoolExecutor(workers) as pool, open(out, 'w') as sink:
    results = list(pool.map(lambda pair: run(*pair), enumerate(MUTANTS)))
    for index, label, verdict in results:
        sink.write(f'{verdict}\t{index}\t{label}\n')
    sink.write('total %d, killed %d, survived %d, not applied %d\n' % (
        len(results), sum(r[2] == 'killed' for r in results), sum(r[2] == 'SURVIVED' for r in results), sum(r[2].startswith('NOT') for r in results)))
