"""Mutation test of the count of V-10 (docs/record-format.md: the record without its Known deviations and Errata sections) in the three implementations.
Each mutant is one replacement in a copy of the repository. A mutant of the library is killed when the tests of the format and of g1 fail on it; a mutant
of reference 1 is killed when the builder of the fixtures (build_cases.py) fails, which it does when a case is not what it was written to show; a mutant
of reference 2 is killed when it does not give the expected problems for a case (run_cases.mjs). The breaks the page names are among them: the
sections counted again, no rule about the empty line after a final line feed, and an off-by-one on the empty line before a section.
Usage: mutate_length.py <repo_dir> <workers> <out.txt>      (node must be on the PATH)"""
import concurrent.futures, os, shutil, subprocess, sys, tempfile
repo, workers, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]

LIB = 'record-keeper.mjs'
REF1 = 'reference/validate_ref.py'
REF2 = 'reference/validate_ref2.mjs'

LIB_COUNT = "  const kept = [...lines.slice(0, end + 1), ...body.filter((_, i) => !cut[i])];\n  return kept.length - (kept.at(-1) === '' ? 1 : 0);"
LIB_CUT = "    if (!fenced[i] && SECTION_HEADING.test(line)) cutting = EXCLUDED_HEADINGS.includes(line);\n    return cutting;"
LIB_CALL = "if (lengthAsAccepted(lines, end, fenced) > MAX_LINES) report(name, 'V-10');"
LIB_CANON = "    if (cut[i]) return;"

REF1_COUNT = "    kept = lines[:end + 1] + [l for i, l in enumerate(body) if i not in cut]\n    return len(kept) - (1 if kept[-1] == '' else 0)"
REF1_CUT = "        if body[i] in EXCLUDED_HEADINGS:\n            cut.update(range(i, heads[k + 1] if k + 1 < len(heads) else len(body)))"
REF1_HEADS = "    heads = [i for i, l in enumerate(body) if not fl[i] and SECTION_HEADING.match(l)]"

REF2_COUNT = "  const kept = pieces.filter((piece) => !['## Known deviations', '## Errata'].includes(piece.opens)).flatMap((piece) => piece.lines);\n  return kept.length - (kept.at(-1) === '' ? 1 : 0);"
REF2_PIECES = "    if (!fenced[i] && /^ {0,3}#{1,2}([ \\t]|$)/.test(line)) pieces.push({ opens: line, lines: [] });"

LIB_WAIVER = "const applies = kind === 'erratum' ? problem.rule !== 'V-10' : kind === 'deviation' && DEVIATION_RULES.has(problem.rule);"
LIB_NOTE_RULES = "const DEVIATION_RULES = new Set(['V-11', 'V-12', 'V-27', 'V-28']);"
CHECK_TESTS = ['test/change.test.mjs']

MUTANTS = [
    # the library: the three breaks that the page names
    (LIB, LIB_COUNT, LIB_COUNT.replace("...body.filter((_, i) => !cut[i])", "...body"), 'library: count the sections again'),
    (LIB, LIB_COUNT, LIB_COUNT.replace(" - (kept.at(-1) === '' ? 1 : 0)", ''), 'library: drop the rule about the empty line after a final line feed'),
    (LIB, LIB_COUNT, LIB_COUNT.replace("? 1 : 0", "? 2 : 0"), 'library: off by one, two empty lines dropped'),
    (LIB, LIB_COUNT, LIB_COUNT.replace("kept.at(-1) === ''", "lines.at(-1) === ''"), 'library: the rule about the final empty line is asked of the whole record'),
    (LIB, LIB_COUNT, LIB_COUNT.replace("!cut[i]", "!(cut[i] || cut[i + 1])"), 'library: the empty line before a section is cut with it'),
    (LIB, LIB_COUNT, LIB_COUNT.replace("(_, i) => !cut[i]", "(line, i) => !cut[i] && line !== ''"), 'library: empty lines are never counted'),
    (LIB, LIB_COUNT, LIB_COUNT.replace("!cut[i]", "!cut[i - 1]"), 'library: the cut is one line late'),
    (LIB, LIB_COUNT, LIB_COUNT.replace("lines.slice(0, end + 1)", "lines.slice(0, end)"), 'library: the closing line of the front matter is not counted'),
    (LIB, LIB_COUNT, LIB_COUNT.replace("lines.slice(0, end + 1)", "lines.slice(0, end + 2)"), 'library: the first line of the body is counted twice'),
    (LIB, LIB_COUNT, LIB_COUNT.replace("1 : 0", "0 : 1"), 'library: the empty line is dropped when there is none'),
    (LIB, LIB_CALL, LIB_CALL.replace('> MAX_LINES', '>= MAX_LINES'), 'library: 60 lines are too long'),
    (LIB, LIB_CALL, LIB_CALL.replace('> MAX_LINES', '> MAX_LINES + 1'), 'library: 61 lines are fine'),
    (LIB, LIB_CALL, LIB_CALL.replace('lengthAsAccepted(lines, end, fenced)', 'lengthAsAccepted(lines, end, fenced.map(() => false))'), 'library: no line is in a fence'),
    # the library: where a section ends
    (LIB, LIB_CUT, LIB_CUT.replace('!fenced[i] && ', ''), 'library: a heading in a fence ends a section'),
    (LIB, LIB_CUT, LIB_CUT.replace('SECTION_HEADING.test(line)', "line.startsWith('## ')"), 'library: only a heading of level 2 in column 1 ends a section'),
    (LIB, LIB_CUT, LIB_CUT.replace('SECTION_HEADING.test(line)', "/^#{1,3}([ \\t]|$)/.test(line)"), 'library: a heading of level 3 ends a section'),
    (LIB, LIB_CUT, LIB_CUT.replace('SECTION_HEADING.test(line)', "/^ {0,3}#{2}([ \\t]|$)/.test(line)"), 'library: a heading of level 1 does not end a section'),
    (LIB, LIB_CUT, LIB_CUT.replace('EXCLUDED_HEADINGS.includes(line)', "line === '## Known deviations'"), 'library: only Known deviations is cut'),
    (LIB, LIB_CUT, LIB_CUT.replace('EXCLUDED_HEADINGS.includes(line)', "line === '## Errata'"), 'library: only Errata is cut'),
    (LIB, LIB_CUT, LIB_CUT.replace('EXCLUDED_HEADINGS.includes(line)', "EXCLUDED_HEADINGS.includes(line) || cutting"), 'library: a section is cut to the end of the record'),
    (LIB, LIB_CUT, LIB_CUT.replace('    return cutting;', '    return cutting && !SECTION_HEADING.test(line);'), 'library: the heading line is counted'),
    (LIB, LIB_CANON, LIB_CANON.replace('cut[i]', '!cut[i]'), 'canonical form: the sections are kept and the rest is cut'),
    (LIB, LIB_CANON, '', 'canonical form: the sections are not cut'),
    # the check of a change, which keeps the waiver of V-10 for an erratum (the sealed text may be lengthened) and does not ask V-10 of a note
    (LIB, LIB_WAIVER, LIB_WAIVER.replace("problem.rule !== 'V-10'", 'true'), 'check-pr: V-10 is asked of an erratum', CHECK_TESTS),
    (LIB, LIB_NOTE_RULES, LIB_NOTE_RULES.replace("'V-11'", "'V-10', 'V-11'"), 'check-pr: V-10 is asked of a deviation note (equivalent: a note changes no line that V-10 counts)', CHECK_TESTS),
    # reference 1
    (REF1, REF1_COUNT, REF1_COUNT.replace("[l for i, l in enumerate(body) if i not in cut]", "list(body)"), 'reference 1: count the sections again'),
    (REF1, REF1_COUNT, REF1_COUNT.replace(" - (1 if kept[-1] == '' else 0)", ''), 'reference 1: drop the rule about the empty line after a final line feed'),
    (REF1, REF1_COUNT, REF1_COUNT.replace("1 if kept[-1]", "2 if kept[-1]"), 'reference 1: off by one, two empty lines dropped'),
    (REF1, REF1_COUNT, REF1_COUNT.replace("i not in cut]", "i not in cut and i + 1 not in cut]"), 'reference 1: the empty line before a section is cut with it'),
    (REF1, REF1_CUT, REF1_CUT.replace("range(i,", "range(i + 1,"), 'reference 1: the heading line is counted'),
    (REF1, REF1_CUT, REF1_CUT.replace("body[i] in EXCLUDED_HEADINGS", "body[i] == '## Errata'"), 'reference 1: only Errata is cut'),
    (REF1, REF1_HEADS, REF1_HEADS.replace("not fl[i] and ", ""), 'reference 1: a heading in a fence ends a section'),
    (REF1, REF1_HEADS, REF1_HEADS.replace("SECTION_HEADING.match(l)", "l.startswith('## ')"), 'reference 1: only a heading of level 2 in column 1 ends a section'),
    # reference 2
    (REF2, REF2_COUNT, REF2_COUNT.replace(".filter((piece) => !['## Known deviations', '## Errata'].includes(piece.opens))", ''), 'reference 2: count the sections again'),
    (REF2, REF2_COUNT, REF2_COUNT.replace(" - (kept.at(-1) === '' ? 1 : 0)", ''), 'reference 2: drop the rule about the empty line after a final line feed'),
    (REF2, REF2_COUNT, REF2_COUNT.replace("? 1 : 0", "? 2 : 0"), 'reference 2: off by one, two empty lines dropped'),
    (REF2, REF2_COUNT, REF2_COUNT.replace("'## Known deviations', ", ''), 'reference 2: only Errata is cut'),
    (REF2, REF2_PIECES, REF2_PIECES.replace('!fenced[i] && ', ''), 'reference 2: a heading in a fence ends a section'),
    (REF2, REF2_PIECES, REF2_PIECES.replace('#{1,2}', '#{2}'), 'reference 2: a heading of level 1 does not end a section'),
    (REF2, REF2_PIECES, REF2_PIECES.replace(' {0,3}', ''), 'reference 2: a heading with spaces in front does not end a section'),
]

LIB_TESTS = ['test/validate.test.mjs', 'test/vectors.test.mjs', 'test/records.test.mjs']
NODE = shutil.which('node')


def command(file, work, tests):
    if file == LIB: return [NODE, '--test', *(tests or LIB_TESTS)]
    if file == REF1: return [sys.executable, 'reference/build_cases.py', os.path.join(work, 'built-cases')]
    return [NODE, 'reference/run_cases.mjs', 'test/fixtures/validate', 'reference/validate_ref2.mjs']


def run(index, mutant):
    file, old, new, label, *tests = mutant
    src = open(os.path.join(repo, file)).read()
    if src.count(old) != 1: return index, label, 'NOT APPLIED (count %d)' % src.count(old)
    if old == new: return index, label, 'NOT APPLIED (no change)'
    work = tempfile.mkdtemp(prefix='mut-length-', dir=os.path.dirname(os.path.abspath(out)))
    try:
        for entry in os.listdir(repo):
            if entry in ('.git', 'node_modules'): continue
            (shutil.copytree if os.path.isdir(os.path.join(repo, entry)) else shutil.copy)(os.path.join(repo, entry), os.path.join(work, entry))
        open(os.path.join(work, file), 'w').write(src.replace(old, new, 1))
        result = subprocess.run(command(file, work, tests[0] if tests else None), cwd=work, capture_output=True, text=True, timeout=900)
        return index, label, 'killed' if result.returncode != 0 else 'SURVIVED'
    except subprocess.TimeoutExpired:
        return index, label, 'TIMEOUT'
    finally:
        shutil.rmtree(work, ignore_errors=True)


with concurrent.futures.ThreadPoolExecutor(workers) as pool, open(out, 'w') as sink:
    results = list(pool.map(lambda pair: run(*pair), enumerate(MUTANTS)))
    for index, label, verdict in results:
        sink.write(f'{verdict}\t{index}\t{label}\n')
    sink.write('total %d, killed %d, survived %d, not applied %d, timeout %d\n' % (
        len(results), sum(r[2] == 'killed' for r in results), sum(r[2] == 'SURVIVED' for r in results), sum(r[2].startswith('NOT') for r in results), sum(r[2] == 'TIMEOUT' for r in results)))
