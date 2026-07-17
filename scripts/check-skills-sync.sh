#!/bin/bash
# Checks that provider plugin skill directories match the canonical skills/ source.
#
# Canonical layout is flat: skills/<skill-name>/SKILL.md
# Claude Code copies live in modular plugins: providers/claude/plugins/<plugin>/skills/<skill-name>
# Cursor copies live in one flat plugin: providers/cursor/plugin/skills/<skill-name>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_SRC="$REPO_ROOT/skills"
out_of_sync=false

# Check structure: skills must be flat (skills/<name>/SKILL.md, not nested)
nested=$(find "$SKILLS_SRC" -mindepth 2 -type d -name "skills" 2>/dev/null)
if [ -n "$nested" ]; then
  echo "ERROR: Nested skills/ directories found. Skills must be flat."
  echo "Expected: skills/<skill-name>/SKILL.md"
  echo "Found nested dirs:"
  echo "$nested"
  exit 1
fi

deep=$(find "$SKILLS_SRC" -name SKILL.md -mindepth 3 2>/dev/null)
if [ -n "$deep" ]; then
  echo "ERROR: SKILL.md files found too deep. Skills must be at skills/<name>/SKILL.md."
  echo "Found:"
  echo "$deep"
  exit 1
fi

# ── Claude Code: modular plugins layout ─────────────────────────────────────
CLAUDE_PLUGINS="$REPO_ROOT/providers/claude/plugins"
if [ ! -d "$CLAUDE_PLUGINS" ]; then
  echo "WARNING: $CLAUDE_PLUGINS does not exist"
else
  # Every provider copy must byte-match its canonical source, and no copy may
  # exist without a canonical source.
  while IFS= read -r skill_copy; do
    skill_name="$(basename "$skill_copy")"
    plugin_rel="${skill_copy#"$REPO_ROOT"/}"
    if [ ! -d "$SKILLS_SRC/$skill_name" ]; then
      echo "Out of sync (no canonical source): $plugin_rel"
      out_of_sync=true
    elif ! diff -r "$SKILLS_SRC/$skill_name" "$skill_copy" > /dev/null 2>&1; then
      echo "Out of sync: $plugin_rel"
      out_of_sync=true
    fi
  done < <(find "$CLAUDE_PLUGINS" -mindepth 3 -maxdepth 3 -type d -path "*/skills/*")

  # Every canonical skill must appear exactly once across the Claude plugins.
  for skill_dir in "$SKILLS_SRC"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name="$(basename "$skill_dir")"
    count=$(find "$CLAUDE_PLUGINS" -mindepth 3 -maxdepth 3 -type d -path "*/skills/$skill_name" | wc -l | tr -d ' ')
    if [ "$count" -eq 0 ]; then
      echo "Missing from Claude plugins: $skill_name"
      out_of_sync=true
    elif [ "$count" -gt 1 ]; then
      echo "Duplicated across Claude plugins ($count copies): $skill_name"
      out_of_sync=true
    fi
  done
fi

# ── Cursor: flat plugin layout ──────────────────────────────────────────────
CURSOR_SKILLS="$REPO_ROOT/providers/cursor/plugin/skills"
if [ ! -d "$CURSOR_SKILLS" ]; then
  echo "WARNING: $CURSOR_SKILLS does not exist"
else
  for skill_dir in "$SKILLS_SRC"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name="$(basename "$skill_dir")"
    if ! diff -r "$skill_dir" "$CURSOR_SKILLS/$skill_name" > /dev/null 2>&1; then
      echo "Out of sync: providers/cursor/plugin/skills/$skill_name"
      out_of_sync=true
    fi
  done
fi

if [ "$out_of_sync" = true ]; then
  echo ""
  echo "Provider skill directories are out of sync with skills/."
  echo "Run: ./scripts/sync-skills.sh"
  exit 1
fi

echo "All provider skill directories are in sync."
