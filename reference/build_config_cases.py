"""Builds test/fixtures/config/cases.json. Every case states the answer it was written to show; the generator runs the Python
reference (config_ref.py) on it and stops if the two differ. Usage: build_config_cases.py <out.json>"""
import json, os, shutil, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
import config_ref as ref
from commit_lib import build_repo

D = {'folder': 'docs/decisions', 'sharedFolder': 'shared', 'extraKeys': [], 'owners': [], 'approvals': 2}
SP = '.github/record-keeper/settings.yml'


def S(folder=None, shared=None, keys=None, owners=None, approvals=2):
    return {'folder': folder or D['folder'], 'sharedFolder': shared or D['sharedFolder'], 'extraKeys': list(keys or []),
            'owners': [{'login': l, 'id': i} for l, i in (owners or [])], 'approvals': approvals}


texts = []


def T(id, text, settings, problems, note):
    """text is a str, or bytes for a file that is not text."""
    texts.append({'id': id, 'text': text, 'settings': settings, 'problems': problems, 'note': note})


def P(line, rule, detail):
    return {'line': line, 'rule': rule, 'detail': detail}


# ---------------------------------------------------------------- files that are read
T('ok01-empty', '', S(), [], 'an empty file sets nothing')
T('ok02-comments-and-blanks', '# Settings\n\n   # indented comment\n  \n', S(), [], 'comments and blank lines only')
T('ok03-folder-plain', 'folder: docs/adr\n', S('docs/adr'), [], 'a plain scalar')
T('ok04-folder-dot-path', 'folder: .records/decisions\n', S('.records/decisions'), [], 'a plain scalar may start with a dot and a letter')
T('ok05-folder-double-quoted', 'folder: "docs/my records"\n', S('docs/my records'), [], 'a double-quoted scalar may hold spaces')
T('ok06-folder-single-quoted', "folder: 'docs/it''s'\n", S("docs/it's"), [], 'a quote inside single quotes is written twice')
T('ok07-shared-folder', 'shared-folder: core\n', S(shared='core'), [], 'the shared folder')
T('ok08-extra-key', 'extra-keys: [repos]\n', S(keys=['repos']), [], 'a list of one')
T('ok09-extra-keys-quotes', 'extra-keys: [repos, \'issue-ref\', "x_y"]\n', S(keys=['repos', 'issue-ref', 'x_y']), [], 'plain and quoted items in one list')
T('ok10-empty-list', 'extra-keys: []\n', S(), [], 'the empty list')
T('ok11-empty-list-spaces', 'extra-keys: [ ]\n', S(), [], 'the empty list with a space inside')
T('ok12-trailing-comments', "folder: docs/adr # where\nshared-folder: 'core' # shared\nextra-keys: [a, b] # keys\n", S('docs/adr', 'core', ['a', 'b']), [], 'a comment after a plain scalar, a quoted scalar and a list')
T('ok13-crlf', 'folder: docs/adr\r\nextra-keys: [a]\r\n', S('docs/adr', None, ['a']), [], 'lines may end with a carriage return and a line feed')
T('ok14-no-final-newline', 'folder: docs/adr', S('docs/adr'), [], 'the last line needs no ending')
T('ok15-all-three', 'folder: docs/adr\nshared-folder: core\nextra-keys: [repos]\n', S('docs/adr', 'core', ['repos']), [], 'every setting')
T('ok16-many-spaces', 'folder:    docs/adr   \n', S('docs/adr'), [], 'spaces after the colon and at the end of the line')
T('ok17-looks-like-bool-quoted', "folder: \"no\"\nextra-keys: ['yes', \"null\", 'On']\n", S('no', None, ['yes', 'null', 'On']), [], 'words that YAML reads as other types are strings when quoted')
T('ok18-list-spacing', 'extra-keys: [ a , b,c ]\n', S(keys=['a', 'b', 'c']), [], 'spaces around items and commas are free')
T('ok19-comment-with-tab-and-unicode', '# a\tb é ☃\nfolder: docs/adr\n', S('docs/adr'), [], 'a tab and non-ASCII text may stand in a comment')
T('ok20-underscore-and-dots', 'folder: _x/a.b-c_d/e\n', S('_x/a.b-c_d/e'), [], 'a plain scalar may start with an underscore and holds dots, hyphens and underscores')
T('ok21-duplicate-item', 'extra-keys: [a, a]\n', S(keys=['a', 'a']), [], 'a key listed twice is kept as written and is no problem')
T('ok22-standard-key', 'extra-keys: [status]\n', S(keys=['status']), [], 'a standard key may be listed and changes nothing')
T('ok23-unicode-folder-quoted', 'folder: "docs/ünï"\n', S('docs/ünï'), [], 'a quoted folder may hold non-ASCII text')
T('ok24-hash-in-quotes', 'folder: "a #b"\nshared-folder: \'c#d\'\n', S('a #b', 'c#d'), [], 'a hash inside quotes is not a comment')
T('ok25-whitespace-only-lines', '   \n\n  \n', S(), [], 'blank lines with spaces')
T('ok26-key-order-and-comments-between', 'extra-keys: [a]\n# c\nfolder: x\n', S('x', None, ['a']), [], 'the order of the keys is free')
T('ok27-colon-in-quotes', 'folder: "a: b"\n', S('a: b'), [], 'a colon inside quotes is text')
T('s07zb-escaped-quote-in-key', 'extra-keys: ["a\\"b"]\nfolder: "say \\"hi\\""\n', S('say "hi"'), [P(1, 'S-07', 'a"b')], 'the escapes of a double-quoted scalar; the item is not a key')
T('ok29-dots-inside-quotes', 'folder: "..."\n', S('...'), [], 'a part of three dots is not . or ..')
T('ok30-github-folder', 'folder: .github/records\nshared-folder: .gitx\n', S('.github/records', '.gitx'), [], 'only .git itself is refused, not names that start with it')
T('ok31-near-misses-of-reserved-words', 'extra-keys: [nul, yess, nope, ny, online, offer, true_, no1, falsey, ynot, nullx]\n', S(keys=['nul', 'yess', 'nope', 'ny', 'online', 'offer', 'true_', 'no1', 'falsey', 'ynot', 'nullx']), [], 'a plain scalar that only starts like a reserved word is plain')
T('ok32-dot-words', 'folder: .infx/.nano/.info\n', S('.infx/.nano/.info'), [], '.inf and .nan are reserved only whole')
T('ok33-comment-after-empty-value-in-other-line', 'folder: a # b # c\n', S('a'), [], 'a comment may hold more hashes')
T('ok34-long-line-valid', 'folder: ' + '/'.join(['a' * 20] * 6) + '\n', S('/'.join(['a' * 20] * 6)), [], 'the length of a value is not limited')
T('ok35-key-case-in-comment', '# Folder: ignored\nfolder: x\n', S('x'), [], 'a comment is not read')

T('ok36b-capital-plain', 'folder: Docs/ADR\n', S('Docs/ADR'), [], 'a plain scalar may start with a capital letter')
T('ok38-capital-keys', 'extra-keys: [Repos, camelCase, A1_b-C]\n', S(keys=['Repos', 'camelCase', 'A1_b-C']), [], 'a front matter key may hold capitals and digits')
T('ok39-git-suffix', 'folder: repo.git\nshared-folder: x.git\n', S('repo.git', 'x.git'), [], 'only the part .git is refused, not a part that ends with it')

# ---------------------------------------------------------------- S-02
T('s02a-not-utf8', b'folder: \xff\n', S(), [P(None, 'S-02', 'not UTF-8')], 'a byte that is not UTF-8')
T('s02b-bom', b'\xef\xbb\xbffolder: docs/adr\n', S(), [P(1, 'S-02', 'byte order mark')], 'a byte order mark; nothing else is read')
T('s02c-bom-in-middle', 'folder: a\n﻿folder: b\n', S(), [P(2, 'S-02', 'byte order mark')], 'a byte order mark anywhere')
T('s02d-nul', '# c\n\x00\n', S(), [P(2, 'S-02', 'control character')], 'a NUL byte, on line 2')
T('s02e-del', '\x7f', S(), [P(1, 'S-02', 'control character')], 'DEL')
T('s02f-c1', '# \u0085\n', S(), [P(1, 'S-02', 'control character')], 'U+0085 is a line end to some YAML readers')
T('s02g-form-feed', 'folder: a\n\x0c\n', S(), [P(2, 'S-02', 'control character')], 'a form feed')
T('s02h-line-separator', '\n# a b\n', S(), [P(2, 'S-02', 'separator or direction control')], 'U+2028')
T('s02i-paragraph-separator', '#  \n', S(), [P(1, 'S-02', 'separator or direction control')], 'U+2029')
T('s02j-rlo', '# ‮\n', S(), [P(1, 'S-02', 'separator or direction control')], 'a right-to-left override')
T('s02k-isolate', '# ⁦\n', S(), [P(1, 'S-02', 'separator or direction control')], 'a direction isolate')
T('s02l-arabic-letter-mark', '# ؜\n', S(), [P(1, 'S-02', 'separator or direction control')], 'U+061C')
T('s02m-bare-cr-mid-line', 'folder: a\rb\n', S(), [P(1, 'S-02', 'bare carriage return')], 'a carriage return inside a line')
T('s02n-bare-cr-at-end', 'folder: a\r', S(), [P(1, 'S-02', 'bare carriage return')], 'a carriage return at the end of the text')
T('s02o-cr-before-crlf', 'a\r\r\nb', S(), [P(1, 'S-02', 'bare carriage return')], 'a carriage return that another carriage return follows')
T('s02p-bom-before-control', '\x00\n﻿', S(), [P(2, 'S-02', 'byte order mark')], 'the byte order mark wins over an earlier control character')
T('s02q-control-before-separator', ' \n\x01', S(), [P(2, 'S-02', 'control character')], 'a control character wins over an earlier separator')
T('s02r-separator-before-cr', 'a\rb\n ', S(), [P(2, 'S-02', 'separator or direction control')], 'a separator wins over an earlier bare carriage return')
T('s02s-stops-reading', 'folder: docs/adr\n\x00\n', S(), [P(2, 'S-02', 'control character')], 'a text that cannot be read sets nothing, not even the line before')
T('s02t-lone-surrogate', b'# \xed\xa0\x80\n', S(), [P(None, 'S-02', 'not UTF-8')], 'a surrogate encoded in UTF-8')
T('s02u-overlong', b'# \xc0\xaf\n', S(), [P(None, 'S-02', 'not UTF-8')], 'an overlong encoding')
T('s02v-truncated', b'folder: \xe2\x82', S(), [P(None, 'S-02', 'not UTF-8')], 'a sequence cut off at the end')
T('s02w-noncharacter', '# ￾\n', S(), [P(1, 'S-02', 'control character')], 'U+FFFE: valid UTF-8 that YAML readers refuse')
T('s02x-noncharacter-ffff', 'folder: a\n# ￿\n', S(), [P(2, 'S-02', 'control character')], 'U+FFFF')
T('s02y-tab-is-not-a-control', '# \t\n', S(), [], 'a tab in a comment is read')
T('s02z-not-utf8-wins-over-everything', b'\xef\xbb\xbf\xff\x00', S(), [P(None, 'S-02', 'not UTF-8')], 'invalid UTF-8 is reported before the byte order mark')
T('s02za-plane-one-ok', '# \U0001F600 \U0001FFFE\nfolder: a\n', S('a'), [], 'characters beyond the first plane are read, also a non-character there')

# ---------------------------------------------------------------- S-03
T('s03a-indented-key', '  folder: x\n', S(), [P(1, 'S-03', '  folder: x')], 'an indented line is not read')
T('s03b-block-list', 'extra-keys:\n  - repos\n', S(), [P(1, 'S-06', 'extra-keys'), P(2, 'S-03', '  - repos')], 'a block list: the key has no value and the item is not read')
T('s03c-block-list-flush', 'extra-keys:\n- repos\n', S(), [P(1, 'S-06', 'extra-keys'), P(2, 'S-03', '- repos')], 'a block list without indentation')
T('s03d-document-marker', '---\nfolder: x\n', S('x'), [P(1, 'S-03', '---')], 'a document marker; the rest is read')
T('s03e-document-end', 'folder: x\n...\n', S('x'), [P(2, 'S-03', '...')], 'a document end')
T('s03f-no-colon', 'folder\n', S(), [P(1, 'S-03', 'folder')], 'a line with no colon')
T('s03g-no-space-after-colon', 'folder:docs\n', S(), [P(1, 'S-03', 'folder:docs')], 'no space after the colon')
T('s03h-tab-after-colon', 'folder:\tdocs\n', S(), [P(1, 'S-03', 'folder:\tdocs')], 'a tab is not white space')
T('s03i-tab-indented-comment', '\t# c\n', S(), [P(1, 'S-03', '\t# c')], 'a tab before a comment')
T('s03j-tab-only', '\t\n', S(), [P(1, 'S-03', '\t')], 'a line of one tab')
T('s03k-unterminated-single', "folder: 'abc\n", S(), [P(1, 'S-03', "folder: 'abc")], 'an unfinished single quote')
T('s03l-unterminated-double', 'folder: "abc\n', S(), [P(1, 'S-03', 'folder: "abc')], 'an unfinished double quote')
T('s03m-unterminated-list', 'extra-keys: [a, b\n', S(), [P(1, 'S-03', 'extra-keys: [a, b')], 'a list that does not close')
T('s03n-trailing-comma', 'extra-keys: [a,]\n', S(), [P(1, 'S-03', 'extra-keys: [a,]')], 'a trailing comma')
T('s03o-nested-list', 'extra-keys: [[a]]\n', S(), [P(1, 'S-03', 'extra-keys: [[a]]')], 'a list in a list')
T('s03p-flow-mapping', 'folder: {a: b}\n', S(), [P(1, 'S-03', 'folder: {a: b}')], 'a mapping')
T('s03q-anchor', 'folder: &a x\n', S(), [P(1, 'S-03', 'folder: &a x')], 'an anchor')
T('s03r-alias', 'folder: *a\n', S(), [P(1, 'S-03', 'folder: *a')], 'an alias')
T('s03s-tag', 'folder: !!str x\n', S(), [P(1, 'S-03', 'folder: !!str x')], 'a tag')
T('s03t-literal-block', 'folder: |\n', S(), [P(1, 'S-03', 'folder: |')], 'a block scalar')
T('s03u-folded-block', 'folder: >\n', S(), [P(1, 'S-03', 'folder: >')], 'a folded block scalar')
T('s03v-plain-with-space', 'folder: docs and records\n', S(), [P(1, 'S-03', 'folder: docs and records')], 'a plain scalar has no spaces')
T('s03w-digit-start', 'folder: 2024-records\nshared-folder: 1x\n', S(), [P(1, 'S-03', 'folder: 2024-records'), P(2, 'S-03', 'shared-folder: 1x')], 'a plain scalar does not start with a digit, and a number with letters after it is not an integer')
T('s03x-trailing-colon', 'folder: docs/decisions:\n', S(), [P(1, 'S-03', 'folder: docs/decisions:')], 'a colon after a value')
T('s03y-text-after-quote', "folder: 'x' y\n", S(), [P(1, 'S-03', "folder: 'x' y")], 'text after a quoted scalar')
T('s03z-hash-without-space', "folder: x#c\nshared-folder: 'x'#c\n", S(), [P(1, 'S-03', 'folder: x#c'), P(2, 'S-03', "shared-folder: 'x'#c")], 'a comment needs a space before the hash')
T('s03za-non-ascii-plain', 'folder: docs/é\n', S(), [P(1, 'S-03', 'folder: docs/é')], 'a plain scalar is ASCII')
T('s03zb-unknown-escape', 'folder: "a\\nb"\n', S(), [P(1, 'S-03', 'folder: "a\\nb"')], 'no escape but \\" and \\\\')
T('s03zc-tab-in-quotes', "folder: 'a\tb'\n", S(), [P(1, 'S-03', "folder: 'a\tb'")], 'a tab inside quotes')
T('s03zd-space-before-colon', 'folder : x\n', S(), [P(1, 'S-03', 'folder : x')], 'no key is recognised, so this line does not count for folder')
T('s03ze-unknown-key-broken-value', "Folder: 'x\n", S(), [P(1, 'S-03', "Folder: 'x")], 'a broken line is S-03 and not S-05')
T('s03zf-nbsp-indent', ' folder: x\n', S(), [P(1, 'S-03', ' folder: x')], 'a no-break space is not a space')
T('s03zg-lines-that-start-oddly', '%YAML 1.2\n- a\n? a\n: a\n, a\n[a]\n{a: b}\n\'a\'\n"a"\n!tag a\n&a b\n*a\n> a\n| a\n@a\n`a`\n', S(),
  [P(i + 1, 'S-03', d) for i, d in enumerate(['%YAML 1.2', '- a', '? a', ': a', ', a', '[a]', '{a: b}', "'a'", '"a"', '!tag a', '&a b', '*a', '> a', '| a', '@a', '`a`'])], 'lines that start with an indicator')
T('s03zh-detail-cut', '  ' + 'x' * 60 + '   \n', S(), [P(1, 'S-03', '  ' + 'x' * 38)], 'the detail loses its trailing spaces and is cut after 40 characters')
T('s03zi-detail-cut-by-characters', 'x: ' + '\U0001F600' * 50 + '\n', S(), [P(1, 'S-03', 'x: ' + '\U0001F600' * 37)], 'the cut counts characters, not UTF-16 units')
T('s03zj-key-with-space', 'a b: c\n', S(), [P(1, 'S-03', 'a b: c')], 'a key has no space')
T('s03zk-numeric-key', '1: a\n', S(), [P(1, 'S-03', '1: a')], 'a key starts with a letter')
T('s03zl-underscore-key', '_a: x\n', S(), [P(1, 'S-03', '_a: x')], 'a key starts with a letter')
T('s03zm-quoted-key', "'folder': x\n", S(), [P(1, 'S-03', "'folder': x")], 'a key is not quoted')
T('s03zn-dot-lone', 'folder: .\n', S(), [P(1, 'S-03', 'folder: .')], 'a lone dot is not plain')
T('s03zo-dot-underscore', 'folder: ._1\n', S(), [P(1, 'S-03', 'folder: ._1')], 'a dot and an underscore read as a number to some YAML readers')
T('ok36-underscore-digit', 'folder: _1\n', S('_1'), [], 'an underscore and a digit: plain')
T('ok37-dot-letter-underscore', 'folder: .a_1\n', S('.a_1'), [], 'a dot, a letter, an underscore and a digit: plain')
T('s03zp-dot-then-digit', 'folder: .5\n', S(), [P(1, 'S-03', 'folder: .5')], 'a dot and a digit read as a number')
T('s03zq-hyphen-start', 'folder: -x\n', S(), [P(1, 'S-03', 'folder: -x')], 'a plain scalar does not start with a hyphen')
T('s03zr-tilde', 'folder: ~\n', S(), [P(1, 'S-03', 'folder: ~')], 'null')
T('s03zs-empty-item', 'extra-keys: [a,,b]\n', S(), [P(1, 'S-03', 'extra-keys: [a,,b]')], 'an empty item')
T('s03zt-space-in-item', 'extra-keys: [a b]\n', S(), [P(1, 'S-03', 'extra-keys: [a b]')], 'two words in one item')
T('s03zu-text-after-list', 'extra-keys: [a] b\n', S(), [P(1, 'S-03', 'extra-keys: [a] b')], 'text after a list')
T('s03zv-colon-in-item', 'extra-keys: [a: b]\n', S(), [P(1, 'S-03', 'extra-keys: [a: b]')], 'a colon in a plain item')
T('s03zw-quote-in-plain', 'folder: a\'b\n', S(), [P(1, 'S-03', "folder: a'b")], 'a quote inside a plain scalar')
T('s03zx-single-escaped-end', "folder: 'a'''\n", S("a'"), [], "'a''' is a followed by a quote")
T('s03zy-single-unfinished-pair', "folder: 'a''\n", S(), [P(1, 'S-03', "folder: 'a''")], 'a doubled quote at the end leaves the scalar open')
T('s03zz-double-backslash-end', 'folder: "a\\"\n', S(), [P(1, 'S-03', 'folder: "a\\"')], 'an escaped quote at the end leaves the scalar open')
T('s03zza-indented-duplicate', 'folder: a\n  folder: b\n', S('a'), [P(2, 'S-03', '  folder: b')], 'an indented line is not a line of the key, so it does not make S-04')
T('s03zzb-word-before-comment', "folder: a b # c\nshared-folder: 'a' b # c\nextra-keys: [a] b # c\n", S(), [P(1, 'S-03', 'folder: a b # c'), P(2, 'S-03', "shared-folder: 'a' b # c"), P(3, 'S-03', 'extra-keys: [a] b # c')], 'text before a comment is still text after the value')
T('s03zzc-one-letter-broken', "x: 'a\n", S(), [P(1, 'S-03', "x: 'a")], 'a one-letter key on a broken line')
for word in ['null', 'Null', 'NULL', 'true', 'True', 'TRUE', 'false', 'False', 'FALSE', 'yes', 'Yes', 'YES', 'no', 'No', 'NO', 'on', 'On', 'ON', 'off', 'Off', 'OFF', 'y', 'Y', 'n', 'N', '.inf', '.Inf', '.INF', '.nan', '.NaN', '.NAN', 'nULl', '.iNf']:
    T('s03r-' + word.lower().replace('.', 'dot-') + '-' + ''.join('u' if c.isupper() else 'l' for c in word if c != '.'), f'extra-keys: [{word}]\n', S(), [P(1, 'S-03', f'extra-keys: [{word}]')], f'the word {word} is not a plain scalar')

# ---------------------------------------------------------------- S-04
T('s04a-folder-twice', 'folder: a\nfolder: b\n', S(), [P(1, 'S-04', 'folder'), P(2, 'S-04', 'folder')], 'both lines are reported and the key takes its default')
T('s04b-three-times', 'shared-folder: a\nshared-folder: b\nshared-folder: c\n', S(), [P(1, 'S-04', 'shared-folder'), P(2, 'S-04', 'shared-folder'), P(3, 'S-04', 'shared-folder')], 'every line of the key')
T('s04c-with-broken', "folder: a\nfolder: 'b\n", S(), [P(1, 'S-04', 'folder'), P(2, 'S-03', "folder: 'b")], 'a broken line counts as a line of its key, and keeps its S-03')
T('s04d-both-broken', "folder: 'a\nfolder: 'b\n", S(), [P(1, 'S-03', "folder: 'a"), P(2, 'S-03', "folder: 'b")], 'two broken lines: S-03 twice and no S-04')
T('s04e-extra-keys-twice', 'extra-keys: [a]\nextra-keys: [b]\n', S(), [P(1, 'S-04', 'extra-keys'), P(2, 'S-04', 'extra-keys')], 'a list set twice')
T('s04f-others-unaffected', 'folder: a\nshared-folder: s\nfolder: b\nextra-keys: [k]\n', S(None, 's', ['k']), [P(1, 'S-04', 'folder'), P(3, 'S-04', 'folder')], 'the other keys are read')
T('s04g-unknown-twice', 'witnesses: [a]\nwitnesses: [b]\n', S(), [P(1, 'S-05', 'witnesses'), P(2, 'S-05', 'witnesses')], 'an unknown key is S-05 on each line and never S-04')
T('s04h-bad-kind-twice', 'folder: [a]\nfolder: [b]\n', S(), [P(1, 'S-04', 'folder'), P(2, 'S-04', 'folder')], 'S-04 comes before the kind is looked at')
T('s04i-case-differs', 'folder: a\nFolder: b\n', S('a'), [P(2, 'S-05', 'Folder')], 'keys are compared exactly')
T('s04j-bad-value-twice', "folder: ''\nfolder: ''\n", S(), [P(1, 'S-04', 'folder'), P(2, 'S-04', 'folder')], 'S-04 comes before the value is looked at')
T('s04k-broken-then-good-then-broken', "folder: 'a\nfolder: b\nfolder: 'c\n", S(), [P(1, 'S-03', "folder: 'a"), P(2, 'S-04', 'folder'), P(3, 'S-03', "folder: 'c")], 'one good line between two broken ones')

# ---------------------------------------------------------------- S-05
T('s05a-unknown', 'witnesses: [alice]\n', S(), [P(1, 'S-05', 'witnesses')], 'a key for a later kit')
T('s05b-capital', 'Folder: x\n', S(), [P(1, 'S-05', 'Folder')], 'case matters')
T('s05c-underscore', 'shared_folder: x\n', S(), [P(1, 'S-05', 'shared_folder')], 'an underscore is not a hyphen')
T('s05d-integer', 'branches: 2\n', S(), [P(1, 'S-05', 'branches')], 'an integer is in the subset, so an unknown key with one is S-05 and not S-03')
T('s05e-word-value', 'compactor: report\n', S(), [P(1, 'S-05', 'compactor')], 'an unknown key with a readable value')
T('s05f-long-key', 'k' * 50 + ': x\n', S(), [P(1, 'S-05', 'k' * 40)], 'the detail is cut')
T('s05g-several', 'owner: [a]\nwitnesses: []\nbranches: [main]\ncompactor: report\n', S(), [P(1, 'S-05', 'owner'), P(2, 'S-05', 'witnesses'), P(3, 'S-05', 'branches'), P(4, 'S-05', 'compactor')], 'each line')
T('s05h-unknown-no-value', 'witnesses:\n', S(), [P(1, 'S-05', 'witnesses')], 'the kind of an unknown key is not looked at')
T('s05i-unknown-list-of-strings', "extra-key: ['x']\n", S(), [P(1, 'S-05', 'extra-key')], 'a near miss')
T('s05j-unknown-in-the-middle', 'folder: a\nwitnesses: [x]\nshared-folder: s\n', S('a', 's'), [P(2, 'S-05', 'witnesses')], 'the lines around it are read')

T('s05k-prototype-names', 'constructor: x\ntoString: [a]\nhasOwnProperty: z\nvalueOf:\nconstructor: y2\n', S(), [P(1, 'S-05', 'constructor'), P(2, 'S-05', 'toString'), P(3, 'S-05', 'hasOwnProperty'), P(4, 'S-05', 'valueOf'), P(5, 'S-05', 'constructor')], 'names of the language are not settings, and a repeated unknown key is S-05 each time')
T('s05l-proto-key', '__proto__: x\n', S(), [P(1, 'S-03', '__proto__: x')], 'a key starts with a letter')

T('s05m-one-letter-key', 'x: a\n', S(), [P(1, 'S-05', 'x')], 'a key of one letter is a key')
T('s05n-digits-in-key', 'a1-b_2: x\n', S(), [P(1, 'S-05', 'a1-b_2')], 'a key may hold digits, hyphens and underscores')

# ---------------------------------------------------------------- S-06
T('s06a-list-for-folder', 'folder: [docs]\n', S(), [P(1, 'S-06', 'folder')], 'a list for a single value')
T('s06b-none-for-folder', 'folder:\n', S(), [P(1, 'S-06', 'folder')], 'no value')
T('s06c-comment-only-value', 'folder: # later\n', S(), [P(1, 'S-06', 'folder')], 'a comment is no value')
T('s06d-list-for-shared', 'shared-folder: [core]\n', S(), [P(1, 'S-06', 'shared-folder')], 'a list for the shared folder')
T('s06e-single-for-list', 'extra-keys: repos\n', S(), [P(1, 'S-06', 'extra-keys')], 'a single value for a list')
T('s06f-none-for-list', 'extra-keys:\n', S(), [P(1, 'S-06', 'extra-keys')], 'no value for a list')
T('s06g-quoted-single-for-list', "extra-keys: 'repos'\n", S(), [P(1, 'S-06', 'extra-keys')], 'a quoted single value for a list')
T('s06h-none-trailing-spaces', 'shared-folder:   \n', S(), [P(1, 'S-06', 'shared-folder')], 'spaces after the colon and nothing else')

# ---------------------------------------------------------------- S-07
T('s07a-folder-empty', "folder: ''\n", S(), [P(1, 'S-07', '')], 'an empty folder')
T('s07b-folder-absolute', 'folder: "/docs"\n', S(), [P(1, 'S-07', '/docs')], 'a leading slash')
T('s07c-folder-trailing-slash', 'folder: docs/\n', S(), [P(1, 'S-07', 'docs/')], 'a trailing slash')
T('s07d-folder-double-slash', 'folder: docs//x\n', S(), [P(1, 'S-07', 'docs//x')], 'an empty part')
T('s07e-folder-dot', 'folder: "."\n', S(), [P(1, 'S-07', '.')], 'the part .')
T('s07f-folder-dotdot', 'folder: ".."\n', S(), [P(1, 'S-07', '..')], 'the part ..')
T('s07g-folder-dotdot-inside', 'folder: a/../b\n', S(), [P(1, 'S-07', 'a/../b')], 'a .. in the middle')
T('s07h-folder-backslash', 'folder: "a\\\\b"\n', S(), [P(1, 'S-07', 'a\\b')], 'a backslash')
T('s07i-folder-dotgit', 'folder: ".git"\n', S(), [P(1, 'S-07', '.git')], '.git')
T('s07j-folder-dotgit-upper', 'folder: .GIT/x\n', S(), [P(1, 'S-07', '.GIT/x')], '.git in capitals')
T('s07k-folder-dotgit-deep', 'folder: a/.Git\n', S(), [P(1, 'S-07', 'a/.Git')], '.git as a later part')
T('s07l-shared-slash', 'shared-folder: a/b\n', S(), [P(1, 'S-07', 'a/b')], 'the shared folder is one part')
T('s07m-shared-dotdot', 'shared-folder: ".."\n', S(), [P(1, 'S-07', '..')], '..')
T('s07n-shared-dotgit', 'shared-folder: .git\n', S(), [P(1, 'S-07', '.git')], '.git')
T('s07o-key-bad-start', "extra-keys: ['1x']\n", S(), [P(1, 'S-07', '1x')], 'a key starts with a letter')
T('s07p-key-with-space', "extra-keys: ['a b']\n", S(), [P(1, 'S-07', 'a b')], 'a key has no space')
T('s07q-key-with-colon', 'extra-keys: ["a:b"]\n', S(), [P(1, 'S-07', 'a:b')], 'a key has no colon')
T('s07r-first-bad-item', "extra-keys: [ok, 'bad key', '2nd']\n", S(), [P(1, 'S-07', 'bad key')], 'the detail is the first item that is not a key, and the list is not used')
T('s07s-key-empty', "extra-keys: ['']\n", S(), [P(1, 'S-07', '')], 'an empty key')
T('s07t-key-with-dot', 'extra-keys: [a.b]\n', S(), [P(1, 'S-07', 'a.b')], 'a dot is a plain character but not a key character')
T('s07u-detail-cut', 'folder: "' + 'x' * 50 + '/"\n', S(), [P(1, 'S-07', 'x' * 40)], 'the detail is cut after 40 characters')
T('s07v-detail-cut-by-characters', 'folder: "' + 'a' * 39 + '\U0001F600bc/"\n', S(), [P(1, 'S-07', 'a' * 39 + '\U0001F600')], 'the cut counts characters')
T('s07w-key-non-ascii', "extra-keys: ['é']\n", S(), [P(1, 'S-07', 'é')], 'a key is ASCII')
T('s07x-folder-slash-only', 'folder: "/"\n', S(), [P(1, 'S-07', '/')], 'two empty parts')
T('s07y-good-folder-bad-keys', "folder: a\nextra-keys: ['!']\nshared-folder: s\n", S('a', 's'), [P(2, 'S-07', '!')], 'the other lines are read')
T('s07z-underscore-key', 'extra-keys: [_x]\n', S(), [P(1, 'S-07', '_x')], 'a key does not start with an underscore')

# ---------------------------------------------------------------- several problems
T('m01-everything', "# settings\nfolder: docs/adr\nwitnesses: [a]\n\nshared-folder: [x]\nextra-keys: ['bad key']\n  stray\nfolder: again\n", S(), [P(2, 'S-04', 'folder'), P(3, 'S-05', 'witnesses'), P(5, 'S-06', 'shared-folder'), P(6, 'S-07', 'bad key'), P(7, 'S-03', '  stray'), P(8, 'S-04', 'folder')], 'one problem on each line, in the order of the lines')
T('m02-one-bad-line-does-not-silence-the-rest', 'folder: docs/adr\nwitnesses: [a]\nextra-keys: [repos]\n', S('docs/adr', None, ['repos']), [P(2, 'S-05', 'witnesses')], 'the settings around a problem are read')
T('m03-comments-keep-line-numbers', '# a\n\n# b\nwitnesses: [x]\n', S(), [P(4, 'S-05', 'witnesses')], 'blank lines and comments count')
T('m04-crlf-line-numbers', '\r\n\r\nwitnesses: [x]\r\n', S(), [P(3, 'S-05', 'witnesses')], 'a carriage return and a line feed make one line end')
T('m05-no-final-newline-problem', 'folder: a\nwitnesses: [x]', S('a'), [P(2, 'S-05', 'witnesses')], 'a problem on the last line without an ending')
T('m06-crlf-and-detail', 'folder: \'x\r\n', S(), [P(1, 'S-03', "folder: 'x")], 'the carriage return is not part of the detail')

# ---------------------------------------------------------------- owners and approvals (M2.4)
T('o01-owners', 'owners: [alice/1001]\n', S(owners=[('alice', 1001)]), [], 'one owner, login and numeric ID')
T('o02-two-owners', 'owners: [alice/1001, bob/1002]\napprovals: 2\n', S(owners=[('alice', 1001), ('bob', 1002)]), [], 'two owners and the default count written out')
T('o03-single-owner-mode', 'owners: [alice/1001]\napprovals: 1\n', S(owners=[('alice', 1001)], approvals=1), [], 'approvals 1: the single-owner mode')
T('o04-login-forms', 'owners: [a/1, A-b-C/2, x1/3, "9z/4", a-1/5, "0/6", "1-a/7"]\n', S(owners=[('a', 1), ('A-b-C', 2), ('x1', 3), ('9z', 4), ('a-1', 5), ('0', 6), ('1-a', 7)]), [], 'letters, digits and single hyphens; a login that starts with a digit needs quotes')
T('o05-39-char-login', 'owners: [' + 'a' * 39 + '/1]\n', S(owners=[('a' * 39, 1)]), [], 'the longest login')
T('o06-15-digit-id', 'owners: [a/999999999999999]\n', S(owners=[('a', 999999999999999)]), [], 'the largest ID: 15 digits')
T('o07-quoted-owner', "owners: ['alice/1001', \"bob/1002\"]\n", S(owners=[('alice', 1001), ('bob', 1002)]), [], 'quoted items are the same strings')
T('o08-empty-owners', 'owners: []\n', S(), [], 'no owners')
T('o09-owners-comment', 'owners: [alice/1001] # the maintainer\n', S(owners=[('alice', 1001)]), [], 'a comment after the list')
T('o10-same-login-two-ids', 'owners: [alice/1001, alice/1002]\n', S(owners=[('alice', 1001), ('alice', 1002)]), [], 'the login is for people; only the ID must differ')
T('o11-approvals-range', 'approvals: 99\n', S(approvals=99), [], 'the largest count')
T('o12-approvals-comment', 'approvals: 3 # three\n', S(approvals=3), [], 'a comment after an integer')
T('o13-approvals-spaces', 'approvals:    1   \n', S(approvals=1), [], 'spaces around an integer')
T('o14-approvals-crlf', 'approvals: 2\r\nowners: [a/1]\r\n', S(owners=[('a', 1)]), [], 'line ends')
T('o15-all-five', 'folder: docs/adr\nshared-folder: core\nextra-keys: [repos]\nowners: [alice/1001]\napprovals: 1\n', S('docs/adr', 'core', ['repos'], [('alice', 1001)], 1), [], 'every setting')
T('o16-owners-no-login-class', 'owners: [a_b/1]\n', S(), [P(1, 'S-07', 'a_b/1')], 'an underscore is not in a login')
T('o17-owner-without-id', 'owners: [alice]\n', S(), [P(1, 'S-07', 'alice')], 'a login alone')
T('o18-owner-id-only', 'owners: ["1001"]\n', S(), [P(1, 'S-07', '1001')], 'an ID alone')
T('o19-owner-integer-item', 'owners: [1001]\n', S(), [P(1, 'S-07', '1001')], 'an integer is a number, not an owner')
T('o20-owner-two-slashes', 'owners: [a/b/1]\n', S(), [P(1, 'S-07', 'a/b/1')], 'one slash')
T('o21-owner-leading-hyphen', 'owners: ["-a/1"]\n', S(), [P(1, 'S-07', '-a/1')], 'a login does not start with a hyphen')
T('o22-owner-trailing-hyphen', 'owners: [a-/1]\n', S(), [P(1, 'S-07', 'a-/1')], 'or end with one')
T('o23-owner-double-hyphen', 'owners: [a--b/1]\n', S(), [P(1, 'S-07', 'a--b/1')], 'or hold two in a row')
T('o24-owner-40-char-login', 'owners: [' + 'a' * 40 + '/1]\n', S(), [P(1, 'S-07', ('a' * 40 + '/1')[:40])], 'a login of 40 characters; the detail is cut at 40')
T('o25-owner-id-zero', 'owners: [a/0]\n', S(), [P(1, 'S-07', 'a/0')], 'an ID is not 0')
T('o26-owner-id-leading-zero', 'owners: [a/01]\n', S(), [P(1, 'S-07', 'a/01')], 'an ID has no leading zero')
T('o27-owner-id-16-digits', 'owners: [a/1000000000000000]\n', S(), [P(1, 'S-07', 'a/1000000000000000')], 'an ID of 16 digits does not fit a double for sure')
T('o28-owner-id-letters', 'owners: [a/12x]\n', S(), [P(1, 'S-07', 'a/12x')], 'an ID is digits')
T('o29-owner-empty-login', 'owners: ["/1"]\n', S(), [P(1, 'S-07', '/1')], 'a login is not empty')
T('o30-owner-empty-id', 'owners: [a/]\n', S(), [P(1, 'S-07', 'a/')], 'an ID is not empty')
T('o31-owner-non-ascii-login', 'owners: ["é/1"]\n', S(), [P(1, 'S-07', 'é/1')], 'a login is ASCII')
T('o32-owner-non-ascii-digit', 'owners: ["a/١"]\n', S(), [P(1, 'S-07', 'a/١')], 'an ID is ASCII digits')
T('o33-owner-space', 'owners: ["a b/1"]\n', S(), [P(1, 'S-07', 'a b/1')], 'no space in a login')
T('o34-owner-bot', 'owners: ["copilot[bot]/1"]\n', S(), [P(1, 'S-07', 'copilot[bot]/1')], 'an app account is not an owner')
T('o35-owner-same-id', 'owners: [alice/1001, bob/1001]\n', S(), [P(1, 'S-07', 'bob/1001')], 'two items with one ID: the second is the problem, and the list has its default')
T('o36-owner-same-id-later', 'owners: [a/1, b/2, c/3, d/2]\n', S(), [P(1, 'S-07', 'd/2')], 'the first item that is not acceptable, here the repeat')
T('o37-owner-bad-then-same', 'owners: [bad, a/1, b/1]\n', S(), [P(1, 'S-07', 'bad')], 'the first bad item is reported, not the repeat after it')
T('o38-owners-single-value', 'owners: alice/1001\n', S(), [P(1, 'S-06', 'owners')], 'a single value for a list')
T('o39-owners-none', 'owners:\n', S(), [P(1, 'S-06', 'owners')], 'no value for a list')
T('o40-owners-twice', 'owners: [a/1]\nowners: [b/2]\n', S(), [P(1, 'S-04', 'owners'), P(2, 'S-04', 'owners')], 'a key set twice: neither is believed')
T('o41-owners-no-slash-plain', 'owners: [alice-1001]\n', S(), [P(1, 'S-07', 'alice-1001')], 'a hyphen is not the separator')
T('o42-owners-colon', 'owners: ["alice:1001"]\n', S(), [P(1, 'S-07', 'alice:1001')], 'a colon is not the separator')
T('o43-owners-mapping', 'owners: [{login: alice, id: 1001}]\n', S(), [P(1, 'S-03', 'owners: [{login: alice, id: 1001}]')], 'a mapping is not in the subset')
T('a01-approvals-zero', 'approvals: 0\n', S(), [P(1, 'S-07', '0')], 'zero would switch the layer off')
T('a02-approvals-100', 'approvals: 100\n', S(), [P(1, 'S-07', '100')], 'above 99')
T('a03-approvals-quoted', 'approvals: "2"\n', S(), [P(1, 'S-07', '2')], 'a string is not a number')
T('a04-approvals-single-quoted', "approvals: '2'\n", S(), [P(1, 'S-07', '2')], 'a string is not a number')
T('a05-approvals-word', 'approvals: two\n', S(), [P(1, 'S-07', 'two')], 'a word')
T('a06-approvals-list', 'approvals: [2]\n', S(), [P(1, 'S-06', 'approvals')], 'a list for a single value')
T('a07-approvals-none', 'approvals:\n', S(), [P(1, 'S-06', 'approvals')], 'nothing for a single value')
T('a08-approvals-twice', 'approvals: 1\napprovals: 2\n', S(), [P(1, 'S-04', 'approvals'), P(2, 'S-04', 'approvals')], 'set twice')
T('a09-approvals-float', 'approvals: 1.5\n', S(), [P(1, 'S-03', 'approvals: 1.5')], 'a float is not an integer of the subset')
T('a10-approvals-exponent', 'approvals: 1e1\n', S(), [P(1, 'S-03', 'approvals: 1e1')], 'nor an exponent')
T('a11-approvals-leading-zero', 'approvals: 02\n', S(), [P(1, 'S-03', 'approvals: 02')], 'a leading zero reads as octal to some YAML readers')
T('a12-approvals-sign', 'approvals: +2\napprovals2: 1\n', S(), [P(1, 'S-03', 'approvals: +2'), P(2, 'S-05', 'approvals2')], 'a sign')
T('a13-approvals-negative', 'approvals: -1\n', S(), [P(1, 'S-03', 'approvals: -1')], 'a negative number')
T('a14-approvals-hex', 'approvals: 0x2\n', S(), [P(1, 'S-03', 'approvals: 0x2')], 'a hexadecimal number')
T('a15-approvals-underscore', 'approvals: 1_0\n', S(), [P(1, 'S-03', 'approvals: 1_0')], 'a digit group')
T('a16-approvals-sexagesimal', 'approvals: 1:30\n', S(), [P(1, 'S-03', 'approvals: 1:30')], 'a base-60 number')
T('a17-approvals-ten-digits', 'approvals: 1234567890\n', S(), [P(1, 'S-03', 'approvals: 1234567890')], 'more than nine digits is not an integer of the subset')
T('a18-approvals-nine-digits', 'approvals: 123456789\n', S(), [P(1, 'S-07', '123456789')], 'nine digits is an integer, and above 99')
T('a19-approvals-comment-no-space', 'approvals: 2#c\n', S(), [P(1, 'S-03', 'approvals: 2#c')], 'a comment needs a space')
T('a20-approvals-trailing-text', 'approvals: 2 x\n', S(), [P(1, 'S-03', 'approvals: 2 x')], 'text after the integer')
T('a21-approvals-dot', 'approvals: 2.\n', S(), [P(1, 'S-03', 'approvals: 2.')], 'a dot after the digits')
T('a22-approvals-slash', 'approvals: 2/3\n', S(), [P(1, 'S-03', 'approvals: 2/3')], 'a slash after the digits')
T('a23-approvals-hyphen', 'approvals: 2-3\n', S(), [P(1, 'S-03', 'approvals: 2-3')], 'a hyphen after the digits')
T('a24-integer-in-list', 'extra-keys: [1, a]\n', S(), [P(1, 'S-07', '1')], 'an integer in a list of keys')
T('a25-integer-in-list-ok-shape', 'owners: [a/1, 7]\n', S(), [P(1, 'S-07', '7')], 'an integer among owners')
T('a26-list-of-integers-spacing', 'extra-keys: [ 12 , 0 ]\n', S(), [P(1, 'S-07', '12')], 'spaces around integers in a list; the first is reported')
T('a27-integer-for-folder', 'folder: 2024\n', S(), [P(1, 'S-07', '2024')], 'a number for a folder')
T('a28-integer-for-shared', 'shared-folder: 0\n', S(), [P(1, 'S-07', '0')], 'a number for the shared folder')
T('a29-quoted-number-for-folder', 'folder: "2024"\nshared-folder: \'0\'\n', S('2024', '0'), [], 'quoted, it is a string')
T('a30-unknown-key-integer-twice', 'branches: 1\nbranches: 2\n', S(), [P(1, 'S-05', 'branches'), P(2, 'S-05', 'branches')], 'an unknown key with integers')
T('a31-list-integer-trailing', 'extra-keys: [1x]\n', S(), [P(1, 'S-03', 'extra-keys: [1x]')], 'a number with letters in a list')
T('a32-approvals-and-owners-lines', 'owners: [alice/1001]\napprovals: 3\n', S(owners=[('alice', 1001)], approvals=3), [], 'more approvals than owners is for the setup check, not a problem here')
T('a33-problem-keeps-other-default', 'owners: [bad]\napprovals: 1\n', S(approvals=1), [P(1, 'S-07', 'bad')], 'a bad owners line leaves nobody, and approvals is read')
T('a34-approvals-bad-owners-ok', 'owners: [alice/1001]\napprovals: 0\n', S(owners=[('alice', 1001)]), [P(2, 'S-07', '0')], 'a bad approvals line leaves 2, and owners is read')
T('a35-approvals-case', 'Approvals: 1\nOwners: [a/1]\n', S(), [P(1, 'S-05', 'Approvals'), P(2, 'S-05', 'Owners')], 'keys are compared exactly')

# ---------------------------------------------------------------- trees
trees = []


def TR(id, files, settings, problems, note):
    trees.append({'id': id, 'files': files, 'settings': settings, 'problems': problems, 'note': note})


GOOD = 'folder: docs/adr\nextra-keys: [repos]\n'
GOOD_S = S('docs/adr', None, ['repos'])
TR('t01-no-file', [{'path': 'README.md', 'content': 'x\n'}], S(), [], 'no settings file: the defaults')
TR('t02-file', [{'path': SP, 'content': GOOD}], GOOD_S, [], 'the file is read')
TR('t03-executable', [{'path': SP, 'content': GOOD, 'mode': '100755'}], GOOD_S, [], 'the executable mode changes nothing')
TR('t04-symlink', [{'path': SP, 'link': '../x'}], S(), [P(None, 'S-01', SP)], 'a symbolic link where the file should be')
TR('t05-directory', [{'path': SP + '/inner.yml', 'content': GOOD}], S(), [P(None, 'S-01', SP)], 'a directory where the file should be')
TR('t06-submodule', [{'path': SP, 'submodule': True}], S(), [P(None, 'S-01', SP)], 'a submodule where the file should be')
TR('t07-github-symlink', [{'path': '.github', 'link': 'elsewhere'}, {'path': 'elsewhere/record-keeper/settings.yml', 'content': GOOD}], S(), [P(None, 'S-01', '.github')], 'a link in front of the file is not followed')
TR('t08-github-file', [{'path': '.github', 'content': 'x\n'}], S(), [P(None, 'S-01', '.github')], '.github is a file')
TR('t09-folder-symlink', [{'path': '.github/record-keeper', 'link': '../elsewhere'}, {'path': '.github/other.yml', 'content': 'x\n'}, {'path': 'elsewhere/settings.yml', 'content': GOOD}], S(), [P(None, 'S-01', '.github/record-keeper')], '.github/record-keeper is a link')
TR('t10-folder-file', [{'path': '.github/record-keeper', 'content': 'x\n'}], S(), [P(None, 'S-01', '.github/record-keeper')], '.github/record-keeper is a file')
TR('t11-github-submodule', [{'path': '.github', 'submodule': True}], S(), [P(None, 'S-01', '.github')], '.github is a submodule')
TR('t12-folder-submodule', [{'path': '.github/record-keeper', 'submodule': True}, {'path': '.github/other.yml', 'content': 'x\n'}], S(), [P(None, 'S-01', '.github/record-keeper')], '.github/record-keeper is a submodule')
TR('t13-elsewhere', [{'path': 'settings.yml', 'content': GOOD}, {'path': '.github/settings.yml', 'content': GOOD}, {'path': '.github/record-keeper/Settings.yml', 'content': GOOD}, {'path': '.github/record-keeper/settings.yaml', 'content': GOOD}, {'path': 'docs/settings.yml', 'content': GOOD}], S(), [], 'only the path of the page is read')
TR('t14-pin-is-not-read', [{'path': '.github/record-keeper.yml', 'content': 'this: is: not: yaml\n'}], S(), [], 'the pin is another file and is not read')
TR('t15-github-without-folder', [{'path': '.github/workflows/x.yml', 'content': 'x\n'}], S(), [], '.github without record-keeper: the defaults')
TR('t16-problems-carry-the-file', [{'path': SP, 'content': 'witnesses: [a]\nfolder: docs/adr\n'}], S('docs/adr'), [P(1, 'S-05', 'witnesses')], 'a problem of the file in a tree')
TR('t17-github-dir-with-links-around', [{'path': '.github/record-keeper/settings.yml', 'content': GOOD}, {'path': '.github/link', 'link': 'record-keeper'}], GOOD_S, [], 'a link beside the folder changes nothing')
TR('t18-file-and-sibling-folder', [{'path': '.github/record-keeper/settings.yml', 'content': GOOD}, {'path': '.github/record-keeper/other', 'content': 'x\n'}], GOOD_S, [], 'other files in the folder change nothing')
TR('t20-owners-in-a-tree', [{'path': SP, 'content': 'owners: [alice/1001, bob/1002]\napprovals: 2\n'}], S(owners=[('alice', 1001), ('bob', 1002)]), [], 'owners and approvals are read from a commit')
TR('t19-bad-utf8-file', [{'path': SP, 'content': b'folder: \xff\n'}], S(), [P(None, 'S-02', 'not UTF-8')], 'bytes that are not UTF-8, read from a blob')

# ---------------------------------------------------------------- check against the reference
def as_bytes(t): return t if isinstance(t, bytes) else t.encode('utf-8')


def norm(problems): return [(p['line'], p['rule'], p['detail']) for p in problems]


failed = 0
for c in texts:
    settings, problems = ref.parse_settings(as_bytes(c['text']))
    if settings != c['settings'] or problems != norm(c['problems']):
        failed += 1
        print('DIFFERENT', c['id'], '\n  intended', c['settings'], norm(c['problems']), '\n  reference', settings, problems)
tmp = tempfile.mkdtemp(prefix='config-cases-')
try:
    repo = os.path.join(tmp, 'r.git')
    layout = []
    for i, t in enumerate(trees):
        entries = {}
        for f in t['files']:
            if 'link' in f: entries[f['path']] = ('120000', f['link'].encode())
            elif f.get('submodule'): entries[f['path']] = ('160000', '0123456789012345678901234567890123456789')
            else: entries[f['path']] = (f.get('mode', '100644'), as_bytes(f['content']))
        layout.append((f't{i}', entries))
    build_repo(repo, layout)
    for i, t in enumerate(trees):
        settings, problems = ref.read_settings(repo, f't{i}')
        got = [(l, r, d) for _, l, r, d in problems]
        if settings != t['settings'] or got != norm(t['problems']):
            failed += 1
            print('DIFFERENT', t['id'], '\n  intended', t['settings'], norm(t['problems']), '\n  reference', settings, got)
finally:
    shutil.rmtree(tmp, ignore_errors=True)
if failed:
    print(failed, 'cases differ'); sys.exit(1)


def encode(c):
    out = {'id': c['id']}
    t = c['text']
    if isinstance(t, bytes):
        try: t = t.decode('utf-8')
        except UnicodeDecodeError: t = None
    if t is None: out['hex'] = c['text'].hex()
    else: out['text'] = t
    out['expect'] = {'settings': c['settings'], 'problems': c['problems']}
    out['note'] = c['note']
    return out


def encode_tree(t):
    files = []
    for f in t['files']:
        g = dict(f)
        if isinstance(g.get('content'), bytes): g['hex'] = g.pop('content').hex()
        files.append(g)
    return {'id': t['id'], 'files': files, 'expect': {'settings': t['settings'], 'problems': t['problems']}, 'note': t['note']}


ids = [c['id'] for c in texts] + [t['id'] for t in trees]
assert len(ids) == len(set(ids)), 'ids repeat'
out = {'texts': [encode(c) for c in texts], 'trees': [encode_tree(t) for t in trees]}
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=True, indent=1)
    f.write('\n')
print(len(texts), 'text cases,', len(trees), 'tree cases; the reference agrees with all of them')
