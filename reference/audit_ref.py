"""Reference implementation of the audit (docs/audit.md), in Python, written from the page. It judges each commit with check_ref (the
reference of the pull request check) and does not share code with the library. The register of numbers is read from the trees of the
commits, not from `git log --name-status` as the library does.

audit(repo, head, from_=None, since=None, evidence=None) -> {'head', 'from', 'folder', 'violations': [...], 'excused': [...], 'acts': [...], 'cases': [...], 'judged': n}
With `evidence` (docs/audit-effects.md; read_evidence of audit_effects_ref.py gives it) the acts of each commit are judged against the reviews; a commit with an
act and no entry raises NoEvidence.
A violation is {'commit', 'kind', 'file', 'rule', 'detail', 'line'?}; commits are ids."""
import os, re, subprocess, sys
sys.path.insert(0, os.path.dirname(__file__))
import approval_ref, check_ref, config_ref
from commit_ref import git, listing, RECORD_FILE

EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
RECORD_ACTS = ('accept', 'erratum', 'deviation', 'amendment')


class NoEvidence(Exception): pass


def ok(repo, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    return subprocess.run(['git', '-C', repo, *args], env=env, capture_output=True).returncode == 0


def lines(repo, *args):
    return [l for l in git(repo, *args).decode('utf-8', 'replace').split('\n') if l]


def message_of(repo, cid):
    return git(repo, 'log', '-1', '--format=%B', cid).decode('utf-8', 'replace')


def names_commit(cited, cid, message):
    if cited.group(3): return cited.group(3) == cid
    n = cited.group(2)
    if cited.group(1) == 'pull':
        subject = message.split('\n')[0]
        return subject.startswith('Merge pull request #%s ' % n) or subject.endswith('(#%s)' % n)
    return re.search(r'(?<![0-9A-Za-z_])#%s(?![0-9])' % n, message) is not None


def pull_of(subject):
    m = re.match(r'Merge pull request #([1-9][0-9]{0,8}) ', subject) or re.search(r'\(#([1-9][0-9]{0,8})\)$', subject)
    return int(m.group(1)) if m else None


def audit(repo, head_rev, from_=None, since=None, evidence=None):
    head = git(repo, 'rev-parse', '--verify', head_rev + '^{commit}').decode().strip()
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update({'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@e', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@e'})
    empty = subprocess.run(['git', '-C', repo, 'commit-tree', EMPTY_TREE, '-m', 'empty'], env=env, capture_output=True, text=True).stdout.strip()
    found, bounds = [], []
    for which, cid in (('from', from_), ('since', since)):
        if cid is None: continue
        if ok(repo, 'rev-parse', '--verify', '--quiet', cid + '^{commit}') and ok(repo, 'merge-base', '--is-ancestor', cid, head): bounds.append(cid)
        else: found.append({'commit': head, 'kind': 'history', 'file': None, 'rule': 'A-01', 'detail': '%s %s' % (which, cid)})
    judged = lines(repo, 'rev-list', '--first-parent', '--reverse', '--parents', head, *['^' + b for b in bounds])
    order = {l.split(' ')[0]: i for i, l in enumerate(judged)}
    acts, cites = [], []
    for l in judged:
        parts = l.split(' ')
        cid, parent = parts[0], parts[1] if len(parts) > 1 else None
        base_id = parent or empty
        res = check_ref.check_pr(repo, base_id, cid, assume=True, root=parent is None)
        refused = []
        if evidence is not None and res['acts']:
            if cid not in evidence: raise NoEvidence(cid)
            entry = evidence[cid]
            if entry['pull'] is None:
                refused = [(kind, p, 'no pull request') for kind, p in res['acts']]
            else:
                pull = entry['pull']
                res = check_ref.check_pr(repo, base_id, cid, assume='cases', since=entry['started'], now=pull['merged'], root=parent is None)
                reviews = [r for r in entry['reviews'] if r['at'] is None or r['at'] <= pull['merged_text']]
                given = config_ref.read_settings(repo, base_id)[0]
                for kind, p in res['acts']:
                    if kind in ('owners', 'amendment'):
                        got = approval_ref.bar(given['owners'], pull['head'], pull['author'], reviews, entry['started'], pull['merged'], kind == 'amendment' and p in res['waived'])
                        if not got['met']: refused.append((kind, p, got['reason']))
                    else:
                        got = approval_ref.count(given['owners'], given['approvals'], pull['head'], pull['author'], reviews)
                        if not got['met']: refused.append((kind, p, '%d of %d approvals' % (got['have'], got['needed'])))
        folder_prefix = config_ref.read_settings(repo, base_id)[0]['folder'] + '/'
        for kind, p, reason in refused:
            name = p[len(folder_prefix):] if kind in RECORD_ACTS and p.startswith(folder_prefix) and RECORD_FILE.match(p[len(folder_prefix):]) else None
            found.append({'commit': cid, 'kind': 'commit', 'file': name, 'rule': 'A-03', 'detail': '%s %s: %s' % (kind, p, reason)})
        for line, rule, detail in res['settings']: found.append({'commit': cid, 'kind': 'commit', 'file': None, 'rule': rule, 'detail': detail or '', 'line': line})
        for f, rule, detail in res['problems']: found.append({'commit': cid, 'kind': 'commit', 'file': f, 'rule': rule, 'detail': detail or ''})
        for kind, p in res['acts']: acts.append({'commit': cid, 'kind': kind, 'path': p})
        for kind, number in res['needs']['cases']: cites.append({'commit': cid, 'kind': kind, 'number': number})

    settings = config_ref.read_settings(repo, head)[0]
    folder = settings['folder']
    prefix = folder + '/'

    def names_of(commit):
        return {p[len(prefix):] for p, (m, t, s) in listing(repo, commit).items()
                if p.startswith(prefix) and '/' not in p[len(prefix):] and m in ('100644', '100755') and RECORD_FILE.match(p[len(prefix):])}
    register, previous = {}, set()
    for cid in lines(repo, 'rev-list', '--first-parent', '--reverse', head):
        now = names_of(cid)
        for name in sorted(now - previous):
            number = int(name[:4])
            if number not in register: register[number] = name
            elif register[number] != name and cid in order:
                found.append({'commit': cid, 'kind': 'register', 'file': name, 'rule': 'A-02', 'detail': '%s: %s -> %s' % (name[:4], register[number], name)})
        previous = now

    cache = {}
    he = listing(repo, head)
    records = check_ref.record_files(he, folder, cache, repo)
    seen = {(v['file'], v['rule'], v['detail']) for v in found if v['kind'] == 'commit'}
    for f, rule, detail in check_ref.state_problems(records):
        if (f, rule, detail or '') not in seen: found.append({'commit': head, 'kind': 'state', 'file': f, 'rule': rule, 'detail': detail or ''})
    files = [p for p, (m, t, s) in he.items() if m in ('100644', '100755')]
    for name, rec in sorted(records.items()):
        if not (rec.readable and rec.sealed and rec.status == 'accepted'): continue
        for item in check_ref.applies_items(rec):
            rx = check_ref.glob_regex(item)
            if not any(rx.fullmatch(f) for f in files) and (name, 'P-18', item) not in seen: found.append({'commit': head, 'kind': 'state', 'file': name, 'rule': 'P-19', 'detail': item})

    messages = {}
    def message(cid):
        if cid not in messages: messages[cid] = message_of(repo, cid)
        return messages[cid]

    def notes_of(name):
        rec = records.get(name)
        if rec is None or not rec.readable or rec.sect['dev'] is None: return []
        first, stop = rec.sect['dev']
        blocks, _ = check_ref.blocks_of(rec.lines[first + 1:stop], 'Deviation')
        out = []
        for b in blocks:
            values, why = check_ref.read_note(b, check_ref.DEVIATION_KEYS, b['n'])
            cited = check_ref.CASE.fullmatch(values['case']) if values else None
            if cited: out.append((b['n'], values['case'], cited))
        return out
    violations, excused = [], []
    for v in found:
        note = None
        if v['kind'] in ('commit', 'register') and v['file'] is not None and RECORD_FILE.match(v['file']):
            note = next((n for n in notes_of(v['file']) if names_commit(n[2], v['commit'], message(v['commit']))), None)
        if note: excused.append({**v, 'note': {'file': v['file'], 'number': note[0], 'case': note[1]}})
        else: violations.append(v)

    def position(v): return -1 if v['kind'] == 'history' else float('inf') if v['kind'] == 'state' else order[v['commit']]
    def key(v): return (position(v), v['file'] is not None, (v['file'] or '').encode(), v['rule'].encode(), (v['detail'] or '').encode(), v.get('line') or 0)
    violations.sort(key=key)
    excused.sort(key=key)
    for a in acts: a['pull'] = pull_of(message(a['commit']).split('\n')[0])
    return {'head': head, 'from': from_, 'folder': folder, 'judged': len(judged), 'violations': violations, 'excused': excused, 'acts': acts, 'cases': cites}
