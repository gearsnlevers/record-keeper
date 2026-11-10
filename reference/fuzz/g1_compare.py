import base64, json, sys, collections
items = json.load(open(sys.argv[1]))
names = sys.argv[2::2]; files = sys.argv[3::2]
res = [json.load(open(f)) for f in files]
assert all(len(r) == len(items) for r in res), [len(r) for r in res]
dis = [i for i in range(len(items)) if len({r[i] for r in res}) > 1]
kinds = collections.Counter()
for r in res[0]: kinds['sealed' if r.startswith('S:') else r[2:]] += 1
print(len(items), 'inputs;', len(dis), 'disagreements')
print('outcome mix (first impl):', dict(sorted(kinds.items())))
for i in dis[:12]:
    t = base64.b64decode(items[i]).decode('utf-8', errors='replace')
    print('---', i, {n: r[i][:40] for n, r in zip(names, res)})
    print(repr(t[:400]))
