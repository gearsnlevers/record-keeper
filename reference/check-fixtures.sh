#!/bin/sh
# Rebuilds every generated fixture into a scratch folder and compares it with the committed one, byte for byte.
# The README.md at the top of a fixture folder is written by hand and is not compared; the README.md files inside the case folders are generated and are.
# Usage: reference/check-fixtures.sh      (needs python3 and git; takes a few minutes, most of it for the change cases)
set -u
here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
failed=0

report() { # name, exit status of the comparison
  if [ "$2" -eq 0 ]; then echo "same      $1"; else echo "DIFFERENT $1"; failed=1; fi
}

folder() { # name, builder, committed folder
  python3 "$here/$2" "$tmp/$1" >"$tmp/$1.log" 2>&1 || { echo "FAILED    $1 (see below)"; tail -5 "$tmp/$1.log"; failed=1; return; }
  [ -z "$(diff -r "$tmp/$1" "$3" 2>&1 | grep -v "^Only in $3: README.md\$")" ]; report "$1" $?
}

file() { # name, builder, committed file, extra arguments of the builder
  name=$1; builder=$2; committed=$3; shift 3
  python3 "$here/$builder" "$@" "$tmp/$name.json" >"$tmp/$name.log" 2>&1 || { echo "FAILED    $name (see below)"; tail -5 "$tmp/$name.log"; failed=1; return; }
  cmp -s "$tmp/$name.json" "$committed"; report "$name" $?
}

folder vectors build_vectors.py "$root/test/vectors/g1"
folder validate build_cases.py "$root/test/fixtures/validate"
file commit build_commit_cases.py "$root/test/fixtures/commit/cases.json" "$root/test/fixtures/validate"
file config build_config_cases.py "$root/test/fixtures/config/cases.json"
file approval build_approval_cases.py "$root/test/fixtures/approval/cases.json"
file applies build_applies_vectors.py "$root/test/fixtures/applies/vectors.json"
file audit build_audit_cases.py "$root/test/fixtures/audit/cases.json"
file audit-effects build_audit_effects_cases.py "$root/test/fixtures/audit-effects/cases.json"
file announce build_announce_cases.py "$root/test/fixtures/announce/cases.json"
file change build_change_cases.py "$root/test/fixtures/change/cases.json"
exit $failed
