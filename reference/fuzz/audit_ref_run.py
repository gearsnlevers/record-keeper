"""Runs audit_ref on a slice of the audit scenarios. Usage: audit_ref_run.py <dir> <lo> <hi> <out.json>"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import audit_ref
d, lo, hi, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
res = {}
for s in json.load(open(os.path.join(d, 'scenarios.json')))[lo:hi]:
    try:
        r = audit_ref.audit(s['repo'], s['head'], from_=s['from'], since=s['since'])
        norm = lambda q: {k: v for k, v in q.items()}
        res[s['id']] = {'judged': r['judged'], 'violations': [norm(q) for q in r['violations']], 'excused': [norm(q) for q in r['excused']], 'acts': r['acts'], 'cases': r['cases']}
    except Exception as e:
        res[s['id']] = {'error': repr(e)}
json.dump(res, open(out, 'w'))
