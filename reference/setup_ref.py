"""A second implementation of the core of the setup check (docs/setup-check.md), in Python with the standard library only. It is written from the page and shares
no code with setup-check.mjs: it reads what the runner read, as plain data, and says what is wrong with the installation of the kit in a repository.

  decide(input)            -> {'findings': [{'code', 'severity', 'detail'}], 'passed': [topic], 'notLookedAt': [{'topic', 'why'}]}
  parse_utc(text)          -> milliseconds, or None
  parse_codeowners(text)   -> {'rules': [{'line', 'pattern', 'owners'}], 'unreadable': [{'line', 'reason'}]}
  matches(pattern, file)   -> bool
  owners_of(rules, file)   -> [owner]

The input of `decide` is the one that setup-check.mjs `decide` takes, as JSON (test/fixtures/setup/README.md says what each part is). The texts of the findings are
not part of the second implementation: a finding is its code, its severity and its detail."""
import calendar
import datetime
import re

CHECK = 'Records integrity'
SECRET = 'RECORD_KEEPER_TOKEN'
SETTINGS_PATH = '.github/record-keeper/settings.yml'
PIN_PATH = '.github/record-keeper.yml'
AUDIT_WORKFLOW = '.github/workflows/records-audit.yml'
COVERED = [
    SETTINGS_PATH,
    PIN_PATH,
    '.github/workflows/records-integrity.yml',
    '.github/workflows/records-audit.yml',
    '.github/workflows/records-setup-check.yml',
    '.github/workflows/records-updater.yml',
]
MAX_AGE_MS = 48 * 3600 * 1000
SKEW_MS = 5 * 60 * 1000
MAX_ACCOUNTS = 30
MAX_LIST = 8
MAX_PATTERN = 300
MAX_PARTS = 12

SEVERITY = {
    'audit-dead': 'error',
    'check-not-required': 'error',
    'check-not-strict': 'warning',
    'bypass-always': 'warning',
    'codeowners-missing': 'warning',
    'codeowners-uncovered': 'warning',
    'owners-few': 'warning',
    'owner-mismatch': 'warning',
    'managed-differs': 'warning',
    'block-unusable': 'warning',
    'manifest-unreadable': 'warning',
    'pin-missing': 'warning',
    'pin-unusable': 'warning',
    'settings-missing': 'warning',
    'settings-unusable': 'warning',
    'secret-not-set': 'warning',
    'audit-workflow-missing': 'warning',
    'audit-record-unreadable': 'warning',
    'audit-record-future': 'warning',
    'single-owner': 'notice',
    'audit-not-yet': 'notice',
    'not-checked': 'notice',
}
ORDER = ['error', 'warning', 'notice']

UTC = re.compile(r'(19[7-9][0-9]|[2-9][0-9]{3})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):([0-5][0-9]):([0-5][0-9])Z', re.ASCII)
OWNER = re.compile(r'@[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:/[A-Za-z0-9._-]{1,100})?|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+', re.ASCII)


def parse_utc(text):
    """The milliseconds of a UTC time written YYYY-MM-DDTHH:MM:SSZ (a real time, from the year 1970), or None."""
    if not isinstance(text, str):
        return None
    found = UTC.fullmatch(text)
    if found is None:
        return None
    try:
        moment = datetime.datetime(*[int(part) for part in found.groups()])
    except ValueError:
        return None
    return calendar.timegm(moment.timetuple()) * 1000


def _strip_slashes(pattern):
    rest = pattern[1:] if pattern.startswith('/') else pattern
    return rest[:-1] if rest.endswith('/') else rest


def pattern_problem(pattern):
    if len(pattern) > MAX_PATTERN:
        return 'a pattern longer than 300 characters'
    if pattern.startswith('!'):
        return 'a pattern that starts with !'
    if re.search(r'[\\\[\]?]', pattern):
        return 'a pattern with \\, [, ] or ?'
    rest = _strip_slashes(pattern)
    if rest == '':
        return 'a pattern with no name'
    parts = rest.split('/')
    if '' in parts:
        return 'a pattern with an empty part'
    if len(parts) > MAX_PARTS:
        return 'a pattern with more than 12 parts'
    if any('**' in part and part != '**' for part in parts):
        return 'a pattern with ** inside a name'
    return None


def parse_codeowners(text):
    rules = []
    unreadable = []
    for index, raw in enumerate(text.split('\n')):
        line = raw[:-1] if raw.endswith('\r') else raw
        words = [word for word in re.split(r'[ \t]+', line) if word != '']
        if not words or words[0].startswith('#'):
            continue
        end = len(words)
        for at in range(1, len(words)):
            if words[at].startswith('#'):
                end = at
                break
        owners = words[1:end]
        bad = [owner for owner in owners if OWNER.fullmatch(owner) is None]
        reason = pattern_problem(words[0])
        if reason is None and bad:
            reason = 'an owner that is not @name, @org/team or an e-mail address'
        if reason is not None:
            unreadable.append({'line': index + 1, 'reason': reason})
        else:
            rules.append({'line': index + 1, 'pattern': words[0], 'owners': owners})
    return {'rules': rules, 'unreadable': unreadable}


def _glob(glob, text):
    """Whether a name matches a pattern in which * stands for any run of characters."""
    g = t = 0
    star = -1
    mark = 0
    while t < len(text):
        if g < len(glob) and glob[g] == '*':
            star = g
            g += 1
            mark = t
        elif g < len(glob) and glob[g] == text[t]:
            g += 1
            t += 1
        elif star >= 0:
            g = star + 1
            mark += 1
            t = mark
        else:
            return False
    while g < len(glob) and glob[g] == '*':
        g += 1
    return g == len(glob)


def matches(pattern, file):
    anchored = pattern.startswith('/')
    folder = pattern.endswith('/')
    parts = _strip_slashes(pattern).split('/')
    names = file.split('/')
    wild = '*' in parts[-1]
    known = {}

    def walk(p, n):
        key = (p, n)
        if key in known:
            return known[key]
        if p == len(parts):
            found = n < len(names) if folder else (n == len(names) or not wild)
        elif parts[p] == '**':
            if p == len(parts) - 1:
                found = n < len(names)
            else:
                found = any(walk(p + 1, n + skip) for skip in range(len(names) - n + 1))
        else:
            found = n < len(names) and _glob(parts[p], names[n]) and walk(p + 1, n + 1)
        known[key] = found
        return found

    if anchored or len(parts) > 1:
        return walk(0, 0)
    return any(walk(0, start) for start in range(len(names)))


def owners_of(rules, file):
    for rule in reversed(rules):
        if matches(rule['pattern'], file):
            return rule['owners']
    return []


def _owner_list(owners):
    return ','.join(sorted(('%s/%d' % (owner['login'], owner['id'])) for owner in owners))


def _lower_ascii(text):
    return re.sub('[A-Z]', lambda letter: letter.group(0).lower(), text)


def decide(input):
    found = []
    passed = []
    not_looked_at = []

    def add(code, detail=''):
        found.append({'code': code, 'severity': SEVERITY[code], 'detail': detail})

    def unchecked(topic, why):
        add('not-checked', '%s: %s' % (topic, why))

    settings = input['settings']
    github = input['github']
    local = input['local']
    now = input['now']

    known = settings['state'] == 'read'
    if settings['state'] == 'absent':
        add('settings-missing')
    elif settings['state'] == 'unreadable':
        add('settings-unusable', 'not a regular file of text')
    elif len(settings['problems']) > 0:
        first = settings['problems'][0]
        detail = first['rule'] + ('' if first['line'] is None else ' at line %d' % first['line'])
        if len(settings['problems']) > 1:
            detail += ' and %d more' % (len(settings['problems']) - 1)
        add('settings-unusable', detail)
    else:
        passed.append('settings')
    if known:
        if len(settings['owners']) < settings['approvals']:
            add('owners-few', '%d listed, %d needed' % (len(settings['owners']), settings['approvals']))
        else:
            passed.append('owners')
        base = input['baseSettings']
        if settings['approvals'] == 1 and input['event'] == 'pull_request' and (
                base['state'] == 'absent' or (base['state'] == 'read' and (base['approvals'] != 1 or _owner_list(base['owners']) != _owner_list(settings['owners'])))):
            add('single-owner')

    if not local and known and len(settings['owners']) > 0:
        asked = settings['owners'][:MAX_ACCOUNTS]
        unread = []
        wrong = 0
        for owner in asked:
            account = github['accounts'].get(str(owner['id']))
            who = '%s/%d' % (owner['login'], owner['id'])
            if account is None or not account['ok']:
                unread.append('%s: %s' % (who, 'not read' if account is None else account['why']))
            elif account['login'] is None:
                wrong += 1
                add('owner-mismatch', '%s: no account has this ID' % who)
            elif _lower_ascii(account['login']) != _lower_ascii(owner['login']):
                wrong += 1
                add('owner-mismatch', '%s: GitHub says %s' % (who, account['login']))
        if len(settings['owners']) > len(asked):
            unread.append('%d more owners' % (len(settings['owners']) - len(asked)))
        if unread:
            unchecked('accounts', '; '.join(unread))
        elif wrong == 0:
            passed.append('owner-accounts')

    codeowners = input['codeowners']
    if codeowners['state'] == 'absent':
        add('codeowners-missing')
    elif codeowners['state'] == 'unreadable':
        unchecked('codeowners', '%s is not a small file of text' % codeowners['path'])
    else:
        parsed = parse_codeowners(codeowners['text'])
        if parsed['unreadable']:
            first = parsed['unreadable'][0]
            unchecked('codeowners', '%s line %d: %s' % (codeowners['path'], first['line'], first['reason']))
        else:
            bare = [file for file in COVERED if len(owners_of(parsed['rules'], file)) == 0]
            if bare:
                add('codeowners-uncovered', ', '.join(bare))
            else:
                passed.append('codeowners')

    release = input['release']
    if local:
        unchecked('github', 'the command line says --local')
    elif not github['repo']['ok']:
        unchecked('repository', github['repo']['why'])
    elif not github['rules']['ok']:
        unchecked('rules', github['rules']['why'])
    else:
        branch = github['repo']['branch']
        requiring = [rule for rule in github['rules']['rules'] if CHECK in rule['checks']]
        classic = github['classic']['ok'] and github['classic']['requires']
        if len(requiring) == 0 and not github['classic']['ok']:
            unchecked('branch protection', github['classic']['why'])
        elif len(requiring) == 0 and not classic:
            add('check-not-required', branch)
        else:
            passed.append('check-required')
            strict = release['upToDate'] if release['state'] == 'read' and release['upToDate'] is not None else True
            if len(requiring) == 0:
                unchecked('strict', 'the check is required by branch protection, and not by a ruleset')
            elif strict and any(rule['strict'] for rule in requiring):
                passed.append('check-strict')
            elif strict:
                add('check-not-strict', branch)
            unseen = []
            hidden = []
            always = 0
            for ruleset_id in sorted(set(rule['id'] for rule in requiring)):
                ruleset = github['bypass'].get(str(ruleset_id))
                if ruleset is None or not ruleset['ok']:
                    unseen.append('ruleset %d: %s' % (ruleset_id, 'not read' if ruleset is None else ruleset['why']))
                elif ruleset['actors'] is None:
                    hidden.append('ruleset %d: the token cannot see the bypass list' % ruleset_id)
                else:
                    for actor in ruleset['actors']:
                        if actor['mode'] != 'pull_request':
                            always += 1
                            add('bypass-always', '%s: %s %s, mode %s' % (ruleset['name'], actor['type'], 'without an ID' if actor['id'] is None else actor['id'], actor['mode']))
            if unseen:
                unchecked('bypass', '; '.join(unseen))
            if hidden:
                not_looked_at.append({'topic': 'bypass', 'why': '; '.join(hidden)})
            if not unseen and not hidden and always == 0 and len(requiring) > 0:
                passed.append('bypass')

    pin = input['pin']
    if input['own']:
        not_looked_at.append({'topic': 'own', 'why': 'this is the repository of the kit: install.json is at its root'})
    elif pin['state'] == 'absent':
        add('pin-missing')
    elif pin['state'] == 'refused':
        add('pin-unusable', pin['code'])
    else:
        passed.append('pin')
        if not local:
            if release['state'] == 'not-checked':
                unchecked('release', release['why'])
            elif release['state'] == 'unlisted':
                add('manifest-unreadable', '%s is not in the list of releases of %s' % (pin['version'], pin['source']))
            elif release['state'] == 'no-asset':
                add('manifest-unreadable', '%s has no release-manifest.json' % pin['version'])
            elif release['state'] == 'refused':
                add('manifest-unreadable', '%s: %s' % (pin['version'], release['code']))
            else:
                passed.append('manifest')
                differing = []
                unusable = []
                for file in sorted(release['files'] + release['blocks'], key=lambda item: item['path'].encode('utf-8')):
                    here = input['tree'].get(file['path'], {'kind': 'absent'})
                    if here['kind'] == 'absent':
                        differing.append('%s (missing)' % file['path'])
                    elif here['kind'] == 'large':
                        unusable.append('too-large')
                    elif here['kind'] == 'block':
                        if here['state'] == 'none':
                            differing.append('%s (block missing)' % file['path'])
                        elif here['state'] == 'refused':
                            unusable.append(here['why'])
                        elif here.get('sha256') != file['sha256'] or here.get('size') != file['size']:
                            differing.append('%s (block differs)' % file['path'])
                    elif here['kind'] != 'file':
                        differing.append('%s (not a file)' % file['path'])
                    elif here.get('sha256') != file['sha256'] or here.get('size') != file['size']:
                        differing.append('%s (differs)' % file['path'])
                if not differing and not unusable:
                    passed.append('managed-files')
                if differing:
                    detail = ', '.join(differing[:MAX_LIST])
                    if len(differing) > MAX_LIST:
                        detail += ', and %d more' % (len(differing) - MAX_LIST)
                    add('managed-differs', detail)
                for why in unusable:
                    add('block-unusable', why)
                if SECRET in release['secrets']:
                    if input['event'] == 'pull_request':
                        not_looked_at.append({'topic': 'secret', 'why': 'a run for a pull request is not given the secrets'})
                    elif input['secretSet'] is None:
                        unchecked('secret', 'the workflow did not say whether it is set')
                    elif input['secretSet']:
                        passed.append('secret')
                    else:
                        add('secret-not-set')

    if not local and github['repo']['ok']:
        is_file = input['auditWorkflow'] == 'file'
        if is_file:
            passed.append('audit-workflow')
        else:
            add('audit-workflow-missing', '' if input['auditWorkflow'] == 'absent' else 'not a file')
        last = github['lastRun']
        if not last['ok']:
            unchecked('audit', last['why'])
        elif last['state'] == 'unreadable':
            add('audit-record-unreadable', last['why'])
        elif last['state'] == 'record':
            at = parse_utc(last['at'])
            if at is None:
                add('audit-record-unreadable', 'at is not a UTC time')
            elif at - now > SKEW_MS:
                add('audit-record-future', last['at'])
            elif now - at > MAX_AGE_MS:
                add('audit-dead', 'the last run was at %s, more than two days ago' % last['at'])
            else:
                passed.append('audit')
        elif is_file:
            age = github.get('age')
            if age is None or not age['ok']:
                unchecked('age', 'not read' if age is None else age['why'])
            elif age['at'] is None:
                add('audit-not-yet', 'there is no record of a run, and the audit workflow is not on the default branch yet')
            else:
                since = parse_utc(age['at'])
                if since is None:
                    unchecked('age', 'the date of the first commit is not a UTC time')
                elif now - since > MAX_AGE_MS:
                    add('audit-dead', 'there is no record of a run, and the audit workflow has been in the repository since %s' % age['at'])
                else:
                    add('audit-not-yet', 'there is no record of a run yet, and the audit workflow is on the default branch since %s' % age['at'])

    findings = [item for severity in ORDER for item in found if item['severity'] == severity]
    return {'findings': findings, 'passed': passed, 'notLookedAt': not_looked_at}
