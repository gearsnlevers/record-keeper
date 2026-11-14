"""Reference implementation of the announcements (docs/announcements.md), in Python, written from the page. It judges with audit_ref and the
effects reference (audit_effects_ref) and does not share code with the library.

read_logins(data: bytes) -> ('ok', {id: login or None}) or ('error', reason)
plan(repo, head, evidence, issues, logins, now) -> ('ok', {'announcements', 'log', 'lookups'}) or ('error', message)"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
import audit_effects_ref as E
import audit_ref, config_ref
from commit_ref import git

KINDS = ['erratum', 'deviation', 'settings', 'owners', 'amendment', 'pin', 'workflow', 'code']   # the order of the title
LIMIT = 20
ROOM = 40000
LOGIN = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}', re.ASCII)
ID = re.compile(r'[1-9][0-9]{0,14}', re.ASCII)
FULL_ID = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})')
INTRO = ('The owners approved an act that is now on the default branch. The audit opens this issue once for each commit and does not change it. '
         'Close it when you have seen it.')


def marker(key): return '<!-- record-keeper:announcement %s -->' % key


def read_logins(data):
    kind, doc = E._document(data)
    if kind == 'error': return (kind, doc)
    if not isinstance(doc, dict): return ('error', 'is not an object')
    out = {}
    for key in sorted(doc, key=lambda k: k.encode('utf-8', 'surrogatepass')):
        if not ID.fullmatch(key): return ('error', '%s: is not an id' % E.printable(key))
        value = doc[key]
        if value is not None and not (isinstance(value, str) and LOGIN.fullmatch(value)):
            return ('error', '%s: is neither a login nor null' % key)
        out[int(key)] = value
    return ('ok', out)


def ann_key(issue):
    user = issue['user']
    if user is None or user['type'] != E.BOT_TYPE or user['login'] != E.BOT_LOGIN: return None
    first = issue['body'].split('\n')[0]
    if first.endswith('\r'): first = first[:-1]
    m = re.fullmatch(r'<!-- record-keeper:announcement (\S+) -->', first)
    return m.group(1) if m and FULL_ID.fullmatch(m.group(1)) else None


def shown(text):
    """Control and format characters other than a line feed and a tab, written as \\u{...}."""
    return ''.join(ch if ch in '\n\t' else E.printable(ch) for ch in text)


def accounts(repo, rev):
    settings = config_ref.read_settings(repo, rev)[0]
    return settings['owners'], settings['witnesses']


def join_and(items):
    if len(items) == 1: return items[0]
    return ', '.join(items[:-1]) + ' and ' + items[-1]


def diff_of(repo, parent, commit, path):
    out = git(repo, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--text', '--full-index', '--diff-algorithm=myers', '--src-prefix=a/', '--dst-prefix=b/', '--unified=3',
              parent, commit, '--', ':(literal)' + path)
    return out.decode('utf-8', 'replace')


def plan(repo, head_rev, evidence, issues, logins, now):
    from_ = E.adoption(repo, head_rev)
    if from_ is None: return ('error', 'no commit of the history holds %s' % E.SETTINGS_PATH)
    try:
        result = audit_ref.audit(repo, head_rev, from_, None, evidence)
    except audit_ref.NoEvidence as e:
        return ('error', 'no evidence for the commit %s' % e.args[0])
    unapproved = {(v['commit'], v['detail']) for v in result['violations'] + result['excused'] if v['rule'] == 'A-03'}

    def approved(act):
        prefix = '%s %s: ' % (act['kind'], act['path'])
        return not any(c == act['commit'] and d.startswith(prefix) for c, d in unapproved)

    commits, acts_of = [], {}
    for act in result['acts']:
        if act['kind'] not in KINDS or not approved(act): continue
        if act['commit'] not in acts_of: commits.append(act['commit']); acts_of[act['commit']] = []
        acts_of[act['commit']].append(act)
    done = {k for k in (ann_key(i) for i in issues) if k is not None}
    todo = [c for c in commits if c not in done][:LIMIT]

    announcements, log, lookups = [], [], set()
    for commit in todo:
        acts = acts_of[commit]
        parent = git(repo, 'rev-parse', commit + '^1').decode().strip()
        owners_b, witnesses_b = accounts(repo, parent)
        owners_c, witnesses_c = accounts(repo, commit)
        login_of = {}
        for group in (owners_c, witnesses_c, owners_b, witnesses_b):
            for a in group: login_of.setdefault(a['id'], a['login'])
        owner_ids = sorted({a['id'] for a in owners_b + owners_c})
        witness_ids = sorted({a['id'] for a in witnesses_b + witnesses_c} - set(owner_ids))
        for uid in owner_ids + witness_ids:
            if uid not in logins: lookups.add(uid)
        told, groups = [], []
        for ids, label in ((owner_ids, 'owners'), (witness_ids, 'witnesses')):
            if not ids: continue
            parts = []
            for uid in ids:
                if uid not in logins: parts.append('%s/%d (not looked up)' % (login_of[uid], uid))
                elif logins[uid] is None: parts.append('%s/%d (no longer an account)' % (login_of[uid], uid))
                else: parts.append('@' + logins[uid]); told.append(uid)
            groups.append('%s (%s)' % (join_and(parts), label))
        told_line = ', '.join(groups)
        number = evidence[commit]['pull']['number']
        kinds = [k for k in KINDS if any(a['kind'] == k for a in acts)]
        lines = [marker(commit), INTRO, '', '- Commit: %s' % commit, '- Pull request: #%d' % number,
                 '- Acts: ' + ', '.join('%s %s' % (a['kind'], E.printable(a['path'])) for a in acts), '- Told: ' + told_line]
        room = ROOM
        for a in acts:
            lines += ['', '### %s %s' % (a['kind'], E.printable(a['path'])), '']
            text = shown(diff_of(repo, parent, commit, a['path']))
            rows = text.split('\n')
            if rows and rows[-1] == '': rows.pop()
            if not rows:
                lines.append('No text changed; see the commit.')
                continue
            used, taken = 0, 0
            for row in rows:
                if used + len(row) + 1 > room: break
                used += len(row) + 1
                taken += 1
            if taken == 0:
                lines.append('The room of this issue is used; see the commit.')
                room = 0
                continue
            longest = max([len(m) for m in re.findall(r'`+', '\n'.join(rows[:taken]))] + [0])
            fence = '`' * max(3, longest + 1)
            lines += [fence + 'diff'] + rows[:taken] + [fence]
            if taken < len(rows):
                lines += ['', '... %d more lines; see the commit.' % (len(rows) - taken)]
                room = 0
            else:
                room -= used
        announcements.append({'key': commit, 'title': 'Act: %s (#%d)' % (', '.join(kinds), number), 'body': '\n'.join(lines) + '\n'})
        log.append({'at': now, 'event': 'announced', 'key': commit, 'acts': [{'kind': a['kind'], 'path': a['path']} for a in acts], 'told': told})
    return ('ok', {'announcements': announcements, 'log': log, 'lookups': sorted(lookups)})
