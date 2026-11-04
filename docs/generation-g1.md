# Generation g1: the canonical form of a record

Status: draft for review (M1). This page becomes normative when record [0001](decisions/0001-accepted-records-are-sealed-and-change-only-by-supersession-or-erratum.md) is accepted. After that it does not change: a different canonical form is a new generation and a new page, and only a clarification that moves no test vector may be made here, with the owners' approval.

A seal is `sha256-g1:` followed by 64 lowercase hexadecimal digits. This page says exactly how those digits are computed from the bytes of a record, so that anyone can recompute a seal with any tool, and what makes a record unfit to be sealed at all. The [test vectors](../test/vectors/g1/README.md) fix the answer for every case below.

## The idea in one paragraph

A record is Markdown with a small block of front matter. The seal covers the record *except* the three front matter keys that change in the ordinary life of a record (`status`, `date`, `seal`) and the two sections that may grow after acceptance (`## Known deviations`, `## Errata`). Before it is hashed, the rest is put into a canonical form that ignores what only a checkout can change (line endings, trailing spaces, the number of blank lines) and nothing else. A record is first checked against a short list of rules; one that breaks a rule is not sealed, because two readers could disagree about what it says or where its excluded sections are.

## Definitions

- **Text.** The record's bytes decoded as UTF-8.
- **Line.** A piece of the text between line feeds (LF, U+000A). A text with *n* line feeds has *n* + 1 lines, so a text that ends in a line feed ends with an empty line. Lines are numbered from 1.
- **Empty line.** A line of no characters. After step 1 below, a line of only spaces or tabs is empty.
- **Space, tab.** U+0020 and U+0009. These two are the only characters this page treats as white space.
- **ASCII lowercase.** Only the letters `A` to `Z` are changed, to `a` to `z`. No other Unicode case folding is used anywhere.
- **Front matter.** Line 1 (`---`) up to and including the next line that is exactly `---`. The **body** is every line after it.
- **Key line.** A front matter line of the form `key:` or `key: value`, where `key` matches `[A-Za-z][A-Za-z0-9_-]*` and `value` is any text; the value of a key line is the text after the colon without the spaces that follow it. A **continuation line** is a front matter line that starts with at least one space followed by a character that is not a space or a tab, and that comes after a key line. A key line owns the continuation lines that follow it, up to the next key line.
- **Excluded keys.** `status`, `date` and `seal`, written in lowercase.
- **Fence.** A body line of three or more backticks followed by text that contains no backtick, starting in column 1, opens a fence. The fence closes at the first later line that consists of at least as many backticks and nothing else. The opening line, the closing line and every line between them are **fenced**. Nothing else is a fence for this page (see G1-14).
- **Excluded sections.** The sections whose heading line is exactly `## Known deviations` or exactly `## Errata`, outside a fence. A section runs from its heading line up to, not including, the next **section heading** or the end of the text. A section heading is a line that is not fenced and matches `^ {0,3}#{1,2}([ \t]|$)`: a Markdown heading of level 1 or 2 (headings of level 3 and deeper stay inside a section).

## The rules

Rules are applied in the order of their numbers, and the first rule a record breaks is the one reported; later rules are not evaluated. A record that breaks none is put into canonical form (the next section).

Rules G1-01 to G1-06 look at the text as it is. From G1-07 on, the rules look at the lines after step 1 of the canonical form (line feeds normalised, trailing spaces and tabs removed). A "line" below always means such a line.

| Rule | A record is rejected when | Why |
| ---- | ------------------------ | --- |
| G1-01 | its bytes are not valid UTF-8 (overlong forms, surrogates and code points above U+10FFFF are not valid) | two readers must see the same characters |
| G1-02 | it contains U+FEFF anywhere, including as a byte order mark | invisible, and it changes what the first line is |
| G1-03 | it contains a control character other than tab, LF and CR: U+0000 to U+0008, U+000B, U+000C, U+000E to U+001F, U+007F to U+009F | escape sequences and NUL hide or alter text; U+0085 is a line break for some readers |
| G1-04 | it contains U+2028, U+2029, or a bidirectional control: U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069 | line breaks that other readers see, and text whose display order differs from its stored order |
| G1-05 | it contains a carriage return (CR, U+000D) that is not directly followed by LF | readers disagree whether a lone CR ends a line |
| G1-06 | it contains the characters `<!--` anywhere | a comment hides text from the person who reads the record, including a heading |
| G1-07 | line 1 is not exactly `---` | there is no front matter |
| G1-08 | no later line is exactly `---` | the front matter never ends |
| G1-09 | a front matter line is neither a key line nor a continuation line | a blank line, a tab indent, a list item in column 1, a comment, `key:value` without a space |
| G1-10 | two key lines have the same key after ASCII lowercase | readers pick different ones |
| G1-11 | `status`, `date` or `seal` is written with a capital letter | a reader that ignores case would still read the key that was cut out |
| G1-12 | an excluded key has no value, or continuation lines | a cut of one line must be a cut of the whole value |
| G1-13 | a value, or a continuation line after an optional `- `, starts with `&`, `*`, `!`, `\|` or `>` | anchors, aliases, tags and block scalars mean different things to different readers |
| G1-14 | a body line outside a fence starts with optional spaces and tabs and then three or more tildes, or with at least one space or tab and then three or more backticks | a fence another reader recognises but this page does not could make a heading look like code |
| G1-15 | a fence is opened and not closed | everything after it would be read as code by some readers |
| G1-16 | a body line outside a fence starts with up to three spaces and `<`, followed by a letter, `/`, `!` or `?`, unless it is an autolink: `<`, a scheme (a letter, then 1 to 31 letters, digits, `+`, `.` or `-`), `:`, text without white space, `<` or `>`, then `>` | a raw HTML block hides what is inside it from the rendered page |
| G1-17 | a body line outside a fence is a setext underline (up to three spaces, then only `=` or only `-`) and it is not the first line of the body, and the line before it is not empty, not fenced and not a level 1 to 6 heading | the line above becomes a heading this page does not see |
| G1-18 | a line that, after removing leading and trailing spaces, tabs and `#`, and ASCII lowercase, reads `known deviations` or `errata`, is not exactly `## Known deviations` or `## Errata` respectively, or is fenced | a heading that only looks like an excluded section: another level, another spelling, a setext title, a heading in a code block |
| G1-19 | an excluded heading occurs twice, or `## Errata` comes before `## Known deviations` | the cut would be ambiguous |
| G1-20 | the line before an excluded heading is not empty | the excluded section must be a section of its own |

G1-18 looks at every line of the record, front matter and fences included, because that is where a fake heading would be hidden. It also rejects a line that merely says `Errata` on its own.

## The canonical form

For a record that passes the rules:

1. **Normalise the lines.** Replace every CRLF by LF. Remove the spaces and tabs at the end of every line.
2. **Cut the excluded keys.** Remove every front matter line that is a key line of an excluded key. (G1-12 guarantees that each owns exactly one line.)
3. **Cut the excluded sections.** Remove every line of every excluded section, heading line included.
4. **Collapse blank lines.** Outside fences, replace every run of two or more empty lines by one empty line. Inside a fence nothing changes.
5. **Trim the end.** Remove the empty lines at the end of the text, join the lines with LF and add one LF at the end.

The **canonical text** is the result. The **seal** is `sha256-g1:` followed by the lowercase hexadecimal SHA-256 digest of the canonical text encoded as UTF-8.

Nothing else is normalised. In particular the order of the keys, the spaces inside a line, the case of every word, Unicode composition (`é` as one code point or two) and the choice of `*` or `-` for a list are all part of the seal.

## What the seal covers

| Change to an accepted record | Changes the seal |
| ---------------------------- | ---------------- |
| The value of `status`, `date` or `seal` | no |
| An entry added to `## Known deviations` or `## Errata`, or the section itself added | no |
| CRLF instead of LF, trailing spaces or tabs, a missing or an extra newline at the end of the file | no |
| Two blank lines where there was one, outside a code block | no |
| A word, a number, a link, a heading, a list marker or the order of the keys | yes |
| A blank line inside a code block | yes |
| A new key, or a key removed | yes |
| Moving text into or out of an excluded section | yes |

## Verifying a record

1. Read the line `seal:` of the front matter. A record without one is not sealed. A record whose value is not exactly `sha256-g1:` and 64 lowercase hexadecimal digits does not verify.
2. Compute the seal of the record by the rules and the canonical form above. If a rule rejects the record, it does not verify.
3. The record verifies if the two are equal.

A seal is made only when a record is accepted, and only under the generation that the repository's pin names (record 0001). To verify, the generation in the seal decides which page applies, and a generation the verifier does not know does not verify.

## Test vectors

The directory [test/vectors/g1](../test/vectors/g1/README.md) holds the vectors: a file per record, and `vectors.json` with the expected result of each. An implementation of g1 is correct when it returns the expected seal for every `seal` vector and the expected rule for every `reject` vector, byte for byte. The files are binary: a checkout must not change their line endings, and the repository says so in `.gitattributes`.

The vectors were computed with one implementation (Python) and confirmed by a second, written from this page alone (Node.js). The two agree on every vector and on all 90 records that the maintainers' repositories had in their decision folders when the vectors were made, and all of those records are accepted by the rules as they are. To find out whether the vectors would catch a wrong implementation, 131 deliberate faults were put into the second one, one at a time (a boundary moved, a rule removed, a regular expression loosened); every fault was caught by at least one vector, except one that cannot change a result. The library of the kit (M1) is the third implementation and must pass the same vectors.
