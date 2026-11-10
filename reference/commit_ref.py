"""Reference implementation of `validate --commit` (docs/reading-a-commit.md), in Python, written from the page.
It goes another way than the library: the folder of the commit is written to disk from its blobs and judged by
validate_ref.py, and the attributes are read in a real clone with the commit checked out, as a working copy sees them.
commit_validate(repo, rev, folder, extra_keys=(), shared_folder='shared') -> list of (file or None, rule, detail)."""
import os, re, subprocess, sys, tempfile, shutil
sys.path.insert(0, os.path.dirname(__file__))
import validate_ref as ref

CONVENTIONAL = ['docs/decisions', 'docs/adr', 'docs/adrs', 'docs/architecture/decisions', 'doc/adr', 'doc/decisions', 'decisions', 'adr', 'adrs']
RECORD_FILE = re.compile(r'^[0-9]{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$')


def git(repo, *args, input=None, env=None):
    e = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    e.update({'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_ATTR_NOSYSTEM': '1'})
    e.update(env or {})
    r = subprocess.run(['git', '-C', repo, *args], input=input, capture_output=True, env=e)
    if r.returncode != 0: raise RuntimeError(f'git {args[0]}: {r.stderr.decode(errors="replace")}')
    return r.stdout


def listing(repo, commit):
    out = {}
    for rec in git(repo, 'ls-tree', '-r', '-t', '-z', '--full-tree', commit).split(b'\0'):
        if not rec: continue
        meta, _, p = rec.partition(b'\t')
        mode, typ, sha = meta.decode().split(' ')
        out[p.decode('utf-8', 'surrogateescape')] = (mode, typ, sha)
    return out


def commit_validate(repo, rev, folder, extra_keys=(), shared_folder='shared'):
    commit = git(repo, 'rev-parse', '--verify', rev + '^{commit}').decode().strip()
    entries = listing(repo, commit)
    folder = folder.strip('/')
    if entries.get(folder, ('', '', ''))[1] != 'tree':
        return [(None, 'V-01', '')]
    prefix = folder + '/'
    direct = {p[len(prefix):]: v for p, v in entries.items() if p.startswith(prefix) and '/' not in p[len(prefix):]}
    out = []
    tmp = tempfile.mkdtemp(prefix='commit-ref-')
    try:
        d = os.path.join(tmp, 'f')
        os.mkdir(d)
        for name, (mode, typ, sha) in direct.items():
            target = os.path.join(d, name)
            if mode in ('100644', '100755'):
                open(target, 'wb').write(git(repo, 'cat-file', 'blob', sha))
            elif mode == '120000':
                os.symlink(git(repo, 'cat-file', 'blob', sha).decode('utf-8', 'surrogateescape'), target)
            elif mode == '040000':
                os.mkdir(target)
            else:
                os.mkfifo(target)   # a submodule, or anything else: neither a regular file nor a directory
        out += ref.validate(d, tuple(extra_keys), shared_folder)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    files = sorted(n for n, (mode, typ, sha) in direct.items() if mode in ('100644', '100755') and not n.startswith('.'))
    # T-01
    for n in files:
        if direct[n][0] == '100755': out.append((n, 'T-01', ''))
    # T-02: a real clone with the commit checked out
    tmp = tempfile.mkdtemp(prefix='commit-ref-')
    try:
        clone = os.path.join(tmp, 'clone')
        subprocess.run(['git', 'clone', '-q', '--no-checkout', '--no-local', repo, clone], check=True, capture_output=True,
                       env={**{k: v for k, v in os.environ.items() if not k.startswith('GIT_')}, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_ATTR_NOSYSTEM': '1'})
        git(clone, 'checkout', '-q', '--detach', commit)
        for n in files:
            raw = git(clone, 'check-attr', '--cached', '-a', '-z', '--', prefix + n).split(b'\0')   # the index: in the work tree an attribute such as working-tree-encoding can make .gitattributes itself unreadable
            attrs = sorted((raw[i + 1].decode(), raw[i + 2].decode()) for i in range(0, len(raw) - 2, 3))
            bad = [(a, v) for a, v in attrs if a not in ('text', 'eol')]
            if bad: out.append((n, 'T-02', ', '.join(f'{a}: {v}' for a, v in bad)))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # T-03
    for c in CONVENTIONAL:
        if c == folder or c.startswith(prefix): continue
        kids = [p[len(c) + 1:] for p in entries if p.startswith(c + '/') and '/' not in p[len(c) + 1:] and entries[p][0] in ('100644', '100755')]
        if any(k == 'README.md' or RECORD_FILE.match(k) for k in kids): out.append((None, 'T-03', c))
    return out


if __name__ == '__main__':
    for r in commit_validate(sys.argv[1], sys.argv[2], sys.argv[3]): print(r)
