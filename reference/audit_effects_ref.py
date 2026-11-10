"""Reference implementation of the effects of the audit (docs/audit-effects.md), in Python, written from the page. It judges with audit_ref (the
reference of the audit) and does not share code with the library. The only thing it reads from the library is the table of what each rule says
(`rule_texts`), because those texts are written nowhere else.

adoption(repo, head) -> the full id of the commit that adopted the kit, or None
read_evidence(data: bytes) -> ('ok', {commit: {'pull', 'started', 'reviews'}}) or ('error', reason)
read_issues(data: bytes) -> ('ok', [issue]) or ('error', reason)
plan(repo, head, adopted, from_, since, evidence, issues, now, texts) -> ('ok', the plan as a dict) or ('error', message)"""
import calendar, json, os, re, sys, time as _time
sys.path.insert(0, os.path.dirname(__file__))
import approval_ref, audit_ref, config_ref
from commit_ref import git, listing, RECORD_FILE

SETTINGS_PATH = config_ref.SETTINGS_PATH
FULL_ID = re.compile(r'(?:[0-9a-f]{40}|[0-9a-f]{64})')
TIME = approval_ref.TIME
BOT_LOGIN, BOT_TYPE = 'github-actions[bot]', 'Bot'
MARKER_KEY = re.compile(r'(?:[0-9]{4}|other|-):[A-Z]-[0-9]{2}')
INTRO = ('The audit of the default branch found this. It is updated on every run and closed when the violation no longer stands. '
         'To resolve it: revert the commit, add an erratum to the record, or add a note to its Known deviations that names the commit.')
RESOLVED = 'No violation of this kind stands. Closed by the audit.'
ORDER = {'open': 0, 'reopen': 1, 'update': 2, 'close': 3}
EVENT = {'open': 'opened', 'reopen': 'reopened', 'update': 'changed', 'close': 'closed'}


def rule_texts(js_path):
    """{rule: text} from the tables SETTINGS_RULES, FORMAT_RULES, COMMIT_RULES, CHANGE_RULES and AUDIT_RULES of the library."""
    source = open(js_path, encoding='utf-8').read()
    texts = {}
    for name in ('SETTINGS_RULES', 'FORMAT_RULES', 'COMMIT_RULES', 'CHANGE_RULES', 'AUDIT_RULES'):
        start = source.index('export const %s = {' % name)
        block = source[start:source.index('\n};', start)]
        for rule, text in re.findall(r"^  '([A-Z]-[0-9]{2})': '(.*)',$", block, re.M):
            texts[rule] = text.replace("\\'", "'")
    return texts


def printable(text):
    out = []
    for ch in text:
        c = ord(ch)
        unsafe = (c in (9, 10, 13, 0xfeff) or 0xfffe <= c <= 0xffff or c <= 0x1f or 0x7f <= c <= 0x9f
                  or c == 0x61c or 0x200e <= c <= 0x200f or 0x2028 <= c <= 0x2029 or 0x202a <= c <= 0x202e or 0x2066 <= c <= 0x2069)
        out.append('\\u{%x}' % c if unsafe else ch)
    return ''.join(out)


def adoption(repo, head_rev):
    head = git(repo, 'rev-parse', '--verify', head_rev + '^{commit}').decode().strip()
    for cid in [l for l in git(repo, 'rev-list', '--first-parent', '--reverse', head).decode().split('\n') if l]:
        entry = listing(repo, cid).get(SETTINGS_PATH)
        if entry is not None and entry[0] in ('100644', '100755') and entry[1] == 'blob': return cid
    return None


def _refuse(constant): raise ValueError(constant)


def _document(data):
    try:
        return ('ok', json.loads(data.decode('utf-8'), parse_constant=_refuse))
    except (UnicodeDecodeError, ValueError, RecursionError):
        return ('error', 'is not one JSON document')


def _time_of(text):
    """Epoch seconds of a time like 2026-11-07T12:00:00Z, or None when the text is not one."""
    if not isinstance(text, str) or not TIME.fullmatch(text): return None
    try:
        return calendar.timegm(_time.strptime(text, '%Y-%m-%dT%H:%M:%SZ'))
    except ValueError:
        return None


def read_evidence(data):
    kind, doc = _document(data)
    if kind == 'error': return (kind, doc)
    if not isinstance(doc, dict): return ('error', 'is not an object')
    out = {}
    for key in sorted(doc, key=lambda k: k.encode('utf-8', 'surrogatepass')):
        if not FULL_ID.fullmatch(key): return ('error', '%s: is not a full commit id' % printable(key))
        value = doc[key]
        if not isinstance(value, dict) or sorted(value) != ['pull', 'reviews', 'started']:
            return ('error', '%s: is not an object with the keys pull, reviews and started' % key)
        pull = value['pull']
        entry = {'pull': None}
        if pull is not None:
            if not isinstance(pull, dict): return ('error', '%s: pull: is not null or an object' % key)
            if not approval_ref.positive_integer(pull.get('number')): return ('error', '%s: pull: number is not a positive integer' % key)
            user = pull.get('user')
            if user is not None and not (isinstance(user, dict) and approval_ref.positive_integer(user.get('id'))):
                return ('error', '%s: pull: user is neither null nor an object with a positive integer id' % key)
            head = pull.get('head')
            if not (isinstance(head, dict) and isinstance(head.get('sha'), str) and FULL_ID.fullmatch(head['sha'])):
                return ('error', '%s: pull: head.sha is not a full commit id' % key)
            merged = _time_of(pull.get('merged_at'))
            if merged is None: return ('error', '%s: pull: merged_at is not a time like 2026-11-07T12:00:00Z' % key)
            entry['pull'] = {'number': int(pull['number']), 'author': None if user is None else int(user['id']), 'head': head['sha'], 'merged': merged, 'merged_text': pull['merged_at']}
        started = value['started']
        if started is not None and _time_of(started) is None:
            return ('error', '%s: started: is neither null nor a time like 2026-11-07T12:00:00Z' % key)
        entry['started'] = None if started is None else _time_of(started)
        got, reviews = approval_ref.read_reviews(json.dumps(value['reviews']).encode())
        if got == 'error': return ('error', '%s: reviews: %s' % (key, reviews))
        entry['reviews'] = reviews
        out[key] = entry
    return ('ok', out)


def read_issues(data):
    kind, doc = _document(data)
    if kind == 'error': return (kind, doc)
    if not isinstance(doc, list): return ('error', 'is not a list')
    pages = [isinstance(x, list) for x in doc]
    if any(pages) and not all(pages): return ('error', 'mixes issues and pages')
    flat = [e for page in doc for e in page] if doc and all(pages) else doc
    out = []
    for n, e in enumerate(flat, 1):
        if not isinstance(e, dict): return ('error', 'entry %d: is not an object' % n)
        if 'pull_request' in e: continue
        if not approval_ref.positive_integer(e.get('number')): return ('error', 'entry %d: number is not a positive integer' % n)
        if e.get('state') not in ('open', 'closed'): return ('error', 'entry %d: state is neither open nor closed' % n)
        if not isinstance(e.get('title'), str): return ('error', 'entry %d: title is not text' % n)
        body = e.get('body')
        if body is not None and not isinstance(body, str): return ('error', 'entry %d: body is neither null nor text' % n)
        user = e.get('user')
        if user is not None and not (isinstance(user, dict) and isinstance(user.get('login'), str) and isinstance(user.get('type'), str)):
            return ('error', 'entry %d: user is neither null nor an object with the text login and type' % n)
        out.append({'number': int(e['number']), 'state': e['state'], 'title': e['title'], 'body': body or '', 'user': user})
    return ('ok', out)


def key_of(violation):
    file = violation['file']
    subject = '-' if file is None else file[:4] if RECORD_FILE.match(file) else 'other'
    return '%s:%s' % (subject, violation['rule'])


def marker(key): return '<!-- record-keeper:incident %s -->' % key


def issue_key(issue):
    user = issue['user']
    if user is None or user['type'] != BOT_TYPE or user['login'] != BOT_LOGIN: return None
    first = issue['body'].split('\n')[0]
    if first.endswith('\r'): first = first[:-1]
    m = re.fullmatch(r'<!-- record-keeper:incident (\S+) -->', first)
    return m.group(1) if m and MARKER_KEY.fullmatch(m.group(1)) else None


def plan(repo, head_rev, adopted, from_, since, evidence, issues, now, texts):
    if adopted:
        from_ = adoption(repo, head_rev)
        if from_ is None: return ('error', 'no commit of the history holds %s' % SETTINGS_PATH)
    try:
        result = audit_ref.audit(repo, head_rev, from_, since, evidence)
    except audit_ref.NoEvidence as e:
        return ('error', 'no evidence for the commit %s' % e.args[0])
    folder = result['folder']
    by_key, order = {}, []
    for v in result['violations']:
        k = key_of(v)
        if k not in by_key: by_key[k] = []; order.append(k)
        by_key[k].append(v)

    def where(v):
        if v['rule'].startswith('S-'): return SETTINGS_PATH + (':%d' % v['line'] if v.get('line') else '')
        return folder if v['file'] is None else folder + '/' + v['file']

    def line(v):
        place = 'the history' if v['kind'] == 'history' else 'the tip ' + result['head'] if v['kind'] == 'state' else v['commit']
        return '- %s: %s: [%s] %s%s\n' % (place, printable(where(v)), v['rule'], texts[v['rule']], ' (%s)' % printable(v['detail']) if v['detail'] else '')

    trusted = {}
    for issue in issues:
        k = issue_key(issue)
        if k is not None: trusted.setdefault(k, []).append(issue)
    actions = []
    for k in sorted(set(by_key) | {k for k, group in trusted.items() if any(i['state'] == 'open' for i in group)}, key=lambda s: s.encode()):
        found = sorted(trusted.get(k, []), key=lambda i: i['number'])
        opened = [i for i in found if i['state'] == 'open']
        subject, rule = k.split(':')
        if k in by_key:
            label = 'other files' if subject == 'other' else 'the repository' if subject == '-' else subject
            title = 'Records: %s: [%s] %s' % (label, rule, texts[rule])
            body = marker(k) + '\n' + INTRO + '\n\n' + ''.join(line(v) for v in by_key[k])
            if not found: actions.append({'action': 'open', 'key': k, 'title': title, 'body': body})
            elif opened:
                if opened[0]['title'] != title or opened[0]['body'] != body: actions.append({'action': 'update', 'key': k, 'number': opened[0]['number'], 'title': title, 'body': body})
                for dup in opened[1:]: actions.append({'action': 'close', 'key': k, 'number': dup['number'], 'body': marker(k) + '\nDuplicate of #%d.\n' % opened[0]['number'], 'duplicate': opened[0]['number']})
            else: actions.append({'action': 'reopen', 'key': k, 'number': found[0]['number'], 'title': title, 'body': body})
        else:
            for i in opened: actions.append({'action': 'close', 'key': k, 'number': i['number'], 'body': marker(k) + '\n' + RESOLVED + '\n'})
    actions.sort(key=lambda a: (a['key'].encode(), ORDER[a['action']], a.get('number', 0)))

    def shown(v): return {'commit': v['commit'], 'kind': v['kind'], 'file': v['file'], 'rule': v['rule'], 'detail': v['detail']}
    log = []
    for a in actions:
        entry = {'at': now, 'event': EVENT[a['action']], 'key': a['key']}
        if 'duplicate' in a: entry['duplicate'] = a['duplicate']
        entry['violations'] = [] if a['action'] == 'close' else [shown(v) for v in by_key[a['key']]]
        log.append(entry)
    issues_out = []
    for a in actions:
        o = {'action': a['action'], 'key': a['key']}
        if 'number' in a: o['number'] = a['number']
        if 'title' in a: o['title'] = a['title']
        o['body'] = a['body']
        issues_out.append(o)
    return ('ok', {'run': {'at': now, 'head': result['head'], 'from': from_, 'judged': result['judged'], 'violations': len(result['violations']), 'excused': len(result['excused'])},
                   'failed': len(result['violations']) != 0, 'issues': issues_out, 'log': log})
