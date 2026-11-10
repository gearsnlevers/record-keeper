"""Runs check_ref on a slice of the errata scenarios. Usage: errata_ref_run.py <dir> <lo> <hi> <out.json>"""
import calendar, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import check_ref
d, lo, hi, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
scen = json.load(open(os.path.join(d, 'scenarios.json')))[lo:hi]
epoch = lambda t: calendar.timegm(time.strptime(t, '%Y-%m-%dT%H:%M:%SZ'))
res = {}
for s in scen:
    try:
        got = check_ref.check_pr(os.path.join(d, 'repo.git'), s['base'], s['head'], cases=s['cases'], since=None if s['since'] is None else epoch(s['since']), now=epoch(s['now']))
        res[s['id']] = {'settings': [list(t) for t in got['settings']], 'problems': [list(t) for t in got['problems']], 'acts': [list(t) for t in got['acts']],
                        'needs': {'cases': [list(t) for t in got['needs']['cases']], 'clock': got['needs']['clock']}}
    except Exception as e:
        res[s['id']] = {'error': repr(e)}
json.dump(res, open(out, 'w'))
