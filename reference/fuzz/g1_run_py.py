import base64, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import g1
items = json.load(open(sys.argv[1]))
res = []
for s in items:
    try: res.append('S:' + g1.seal_g1(base64.b64decode(s)))
    except g1.Reject as e: res.append('R:' + e.rule)
json.dump(res, open(sys.argv[2], 'w'))
