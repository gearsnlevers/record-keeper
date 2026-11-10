"""Build git repositories from a list of trees, with `git fast-import`, so that modes, symbolic links and submodules can be
set without a checkout. build_repo(path, trees) with trees = [(ref name, {path: (mode, content)})]; content is bytes, or for
mode 160000 a 40-digit hexadecimal id. Returns nothing; the refs are refs/heads/<name>."""
import os, subprocess

def _data(b): return b'data %d\n' % len(b) + b + b'\n'

def build_repo(path, trees):
    subprocess.run(['git', 'init', '-q', '--bare', path], check=True, capture_output=True)
    s = b''
    for name, entries in trees:
        s += b'commit refs/heads/' + name.encode() + b'\ncommitter T <t@example.com> 0 +0000\n' + _data(b'case') + b'deleteall\n'
        for p, (mode, content) in sorted(entries.items()):
            pb = p.encode('utf-8', 'surrogateescape')
            if mode == '160000': s += b'M 160000 ' + content.encode() + b' ' + pb + b'\n'
            else: s += b'M ' + mode.encode() + b' inline ' + pb + b'\n' + _data(content)
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    subprocess.run(['git', '-C', path, 'fast-import', '--quiet'], input=s, check=True, capture_output=True, env=env)
