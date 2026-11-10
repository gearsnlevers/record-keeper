"""Runs check_ref on a slice of the scenarios. Usage: change_ref_run.py <dir> <lo> <hi> <out.json>"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import check_ref
d, lo, hi, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
scen = json.load(open(os.path.join(d, 'scenarios.json')))[lo:hi]
res = {}
for s in scen:
    try:
        got = check_ref.check_pr(os.path.join(d, 'repo.git'), s['base'], s['head'], cases={'issue': [12], 'pull': [5]})
        res[s['id']] = {'settings': [list(t) for t in got['settings']], 'problems': [list(t) for t in got['problems']], 'acts': [list(t) for t in got['acts']]}
    except Exception as e:
        res[s['id']] = {'error': repr(e)}
json.dump(res, open(out, 'w'))
