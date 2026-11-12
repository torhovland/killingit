#!/usr/bin/env bash
# Print the open GitHub issues that should be fixed next, in priority order.
set -euo pipefail

mode="top"
label=""
limit="${ISSUE_LIMIT:-200}"

usage() {
  cat <<'EOF'
Usage: next-issues.sh [--list | --json] [--label LABEL] [--limit N]

Prints the open GitHub issues in this repository in priority order. Issues are
ordered by priority label (high, medium, low, then unlabelled), then oldest
first, so older work is finished before newer work of equal priority.

  --list           Print every open issue in priority order, tab separated.
  --json           Print the sorted issues as JSON.
  --label LABEL    Only consider issues with this label.
  --limit N        Fetch at most N issues (default: 200, or $ISSUE_LIMIT).

Without options the most important issue is printed in full, ready to work on.
Pipe `--list` through `head -n 10` to get the ten most important issues.

Exit status is 0 even when the repository has no open issues.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list) mode="list" ;;
    --json) mode="json" ;;
    --label)
      [[ $# -ge 2 ]] || { echo "missing value for --label" >&2; exit 2; }
      label="$2"
      shift
      ;;
    --limit)
      [[ $# -ge 2 ]] || { echo "missing value for --limit" >&2; exit 2; }
      limit="$2"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

command -v gh >/dev/null || { echo "gh is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

args=(--state open --limit "$limit" --json number,title,url,labels,createdAt)
if [[ -n "$label" ]]; then
  args+=(--label "$label")
fi

issues=$(gh issue list "${args[@]}")

if [[ "$mode" == "json" ]]; then
  jq 'sort_by(
        ([.labels[].name] |
          if index("priority: high") then 0
          elif index("priority: medium") then 1
          elif index("priority: low") then 2
          else 3 end),
        .createdAt
      )' <<<"$issues"
  exit 0
fi

sorted=$(jq -r '
  def priority_rank:
    [.labels[].name] |
    if index("priority: high") then 0
    elif index("priority: medium") then 1
    elif index("priority: low") then 2
    else 3 end;
  def priority_name:
    [.labels[].name] |
    if index("priority: high") then "priority: high"
    elif index("priority: medium") then "priority: medium"
    elif index("priority: low") then "priority: low"
    else "no priority" end;

  sort_by(priority_rank, .createdAt)[] |
  [.number, priority_name, .title, .url] | @tsv
' <<<"$issues")

if [[ -z "$sorted" ]]; then
  echo "No open issues found." >&2
  exit 0
fi

if [[ "$mode" == "list" ]]; then
  printf '%s\n' "$sorted"
  exit 0
fi

first_number=$(head -n 1 <<<"$sorted" | cut -f1)
gh issue view "$first_number" \
  --json number,title,url,labels,assignees,body |
  jq -r '
    "Issue #\(.number): \(.title)",
    "URL: \(.url)",
    "Priority: " + ([.labels[].name] |
      if index("priority: high") then "high"
      elif index("priority: medium") then "medium"
      elif index("priority: low") then "low"
      else "none" end),
    "Labels: " + ([.labels[].name] | join(", ")),
    "Assignees: " + (if (.assignees | length) == 0 then "none" else ([.assignees[].login] | join(", ")) end),
    "",
    .body
  '
