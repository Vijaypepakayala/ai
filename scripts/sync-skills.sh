#!/bin/bash
# Syncs skills from the canonical skills/ directory to provider plugin directories.
#
# Claude Code: multi-plugin structure under providers/claude/plugins/<plugin-name>/skills/
# Cursor: flat structure under providers/cursor/plugin/skills/
#
# Plugin groupings are defined by prefix patterns in scripts/plugin-patterns.sh
# (shared with check-skills-sync.sh). To add a new product plugin, add it to
# the PLUGIN_PATTERNS array there.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS_SRC="$REPO_ROOT/skills"

# ── Plugin groupings ────────────────────────────────────────────────────────
# PLUGIN_PATTERNS is shared with check-skills-sync.sh via plugin-patterns.sh.
source "$REPO_ROOT/scripts/plugin-patterns.sh"

# ── Claude Code: multi-plugin sync ──────────────────────────────────────────
CLAUDE_PLUGINS="$REPO_ROOT/providers/claude/plugins"
echo "Syncing skills to Claude Code plugins ..."

for entry in "${PLUGIN_PATTERNS[@]}"; do
  IFS='|' read -r plugin_name prefixes catch_all <<< "$entry"
  plugin_dir="$CLAUDE_PLUGINS/$plugin_name"
  skills_dir="$plugin_dir/skills"

  if [ ! -d "$plugin_dir" ]; then
    echo "  ⚠ Skipping $plugin_name — plugin directory not found"
    continue
  fi

  rm -rf "$skills_dir"
  mkdir -p "$skills_dir"

  count=0
  for skill_dir in "$SKILLS_SRC"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name=$(basename "$skill_dir")

    # Check if this skill matches any prefix for this plugin
    match=0
    if [ "$catch_all" = "1" ]; then
      # Catch-all plugin: check that no other plugin claimed this skill
      match=1
      for other in "${PLUGIN_PATTERNS[@]}"; do
        IFS='|' read -r other_name other_prefixes other_catch <<< "$other"
        [ "$other_catch" = "1" ] && continue
        [ "$other_name" = "$plugin_name" ] && continue
        IFS=',' read -ra prefix_list <<< "$other_prefixes"
        for prefix in "${prefix_list[@]}"; do
          if [[ "$skill_name" == "$prefix"* ]]; then
            match=0
            break
          fi
        done
        [ "$match" = "0" ] && break
      done
    else
      # Normal plugin: check prefixes
      IFS=',' read -ra prefix_list <<< "$prefixes"
      for prefix in "${prefix_list[@]}"; do
        if [[ "$skill_name" == "$prefix"* ]]; then
          match=1
          break
        fi
      done
    fi

    if [ "$match" = "1" ]; then
      cp -R "$skill_dir" "$skills_dir/$skill_name"
      ((++count))
    fi
  done

  echo "  $plugin_name — $count skills synced"
done

total_claude=$(find "$CLAUDE_PLUGINS" -name "SKILL.md" | wc -l | tr -d ' ')
echo "  Done — $total_claude skills across Claude Code plugins"

# ── Cursor: flat sync (all skills) ───────────────────────────────────────────
CURSOR_SKILLS="$REPO_ROOT/providers/cursor/plugin/skills"
echo "Syncing skills to Cursor plugin ..."
rm -rf "$CURSOR_SKILLS"
mkdir -p "$CURSOR_SKILLS"

for skill_dir in "$SKILLS_SRC"/*/; do
  [ -d "$skill_dir" ] || continue
  skill_name=$(basename "$skill_dir")
  cp -R "$skill_dir" "$CURSOR_SKILLS/$skill_name"
done

total_cursor=$(find "$CURSOR_SKILLS" -name "SKILL.md" | wc -l | tr -d ' ')
echo "  Done — $total_cursor skills synced"

echo "All providers synced."