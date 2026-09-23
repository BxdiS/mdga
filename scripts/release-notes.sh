#!/usr/bin/env bash
# Release notes for a build: one line per change on main since the
# previous build, CLI style.
#
#   scripts/release-notes.sh <owner/repo> [previous-build-sha]
#
# Walks main's first-parent history, so every merged PR is one line whatever
# the merge method: a merge commit ("Merge pull request #7 ...") is replaced
# by the PR title, a squash commit ("feat: x (#7)") keeps its own subject.
# Without a previous build it lists the last 30 changes.
set -euo pipefail

repo="$1"
prev="${2:-}"
head_short=$(git rev-parse --short=7 HEAD)

if [ -n "$prev" ]; then
  range=("$prev..HEAD")
else
  range=(-n 30 HEAD)
fi

merge_re='^Merge pull request #([0-9]+)'
squash_re='^(.*) \(#([0-9]+)\)$'
conv_re='^([a-z]+(\([^)]*\))?!?): (.*)$'

kinds=()
texts=()
while IFS=$'\t' read -r sha subject; do
  [ -z "$sha" ] && continue
  pr=""
  if [[ $subject =~ $merge_re ]]; then
    pr="${BASH_REMATCH[1]}"
    subject=$(gh api "repos/$repo/pulls/$pr" --jq .title 2>/dev/null || echo "$subject")
  elif [[ $subject =~ $squash_re ]]; then
    subject="${BASH_REMATCH[1]}"
    pr="${BASH_REMATCH[2]}"
  elif [[ $subject == "Merge "* ]]; then
    continue # branch syncs, not changes
  fi
  if [[ $subject =~ $conv_re ]]; then
    kind="${BASH_REMATCH[1]}"
    text="${BASH_REMATCH[3]}"
  else
    kind="-" # ASCII: printf pads by bytes, so a multibyte marker misaligns
    text="$subject"
  fi
  [ -n "$pr" ] && text="$text  #$pr"
  kinds+=("$kind")
  texts+=("$text")
done < <(git log --first-parent --pretty=format:'%h%x09%s' "${range[@]}"; echo)

width=0
for k in "${kinds[@]+"${kinds[@]}"}"; do
  [ ${#k} -gt $width ] && width=${#k}
done

echo '```'
echo "mdga $head_short  $(date -u +%Y-%m-%d)"
echo
if [ ${#kinds[@]} -eq 0 ]; then
  echo "no changes since the previous build"
else
  for i in "${!kinds[@]}"; do
    printf "%-${width}s  %s\n" "${kinds[$i]}" "${texts[$i]}"
  done
fi
echo '```'
echo
echo '```powershell'
echo "irm https://github.com/$repo/releases/latest/download/install.ps1 | iex"
echo '```'
if [ -n "$prev" ]; then
  prev_short=$(git rev-parse --short=7 "$prev")
  echo
  echo "[\`$prev_short...$head_short\`](https://github.com/$repo/compare/$prev_short...$head_short)"
fi
