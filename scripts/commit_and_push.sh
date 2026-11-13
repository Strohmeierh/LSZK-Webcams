#!/usr/bin/env bash
# Commit the given files (if they changed) and push, rebasing on concurrent pushes
# (the weather and METAR workflows push to the same branch).
# Usage: bash scripts/commit_and_push.sh "<commit message>" <file>...
set -u
msg="$1"
shift

files=()
for f in "$@"; do
  if [[ -e "$f" ]]; then files+=("$f"); fi
done
if [[ ${#files[@]} -eq 0 || -z "$(git status --porcelain -- "${files[@]}")" ]]; then
  echo "No changes."
  exit 0
fi

git config user.name  "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
if ! git add -- "${files[@]}" || ! git commit -q -m "$msg"; then
  echo "git add/commit failed" >&2
  exit 1
fi

for i in 1 2 3; do
  if git push -q; then exit 0; fi
  echo "Push rejected (attempt $i), rebasing on the latest remote state"
  # during a rebase "theirs" is this job's own commit: on a conflict in these data files it wins
  if ! git pull --rebase -X theirs -q origin "$GITHUB_REF_NAME"; then
    git rebase --abort 2>/dev/null || true
    sleep 5
  fi
done
echo "Push failed after 3 attempts" >&2
exit 1
