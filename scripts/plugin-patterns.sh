# Shared Claude Code plugin groupings, sourced by sync-skills.sh and
# check-skills-sync.sh so syncing and validation always agree.
#
# Format: "plugin_name|prefix1,prefix2,...|catch_all_flag"
# catch_all_flag=1 means this plugin gets all skills not matched by other plugins.
# To add a new product plugin, add it here.
PLUGIN_PATTERNS=(
  "telnyx-whatsapp|telnyx-whatsapp-|0"
  "telnyx-voice|telnyx-voice-,telnyx-ai-outbound-voice|0"
  "telnyx-messaging|telnyx-messaging-|0"
  "telnyx-tts|telnyx-tts-|0"
  "telnyx-stt|telnyx-stt-|0"
  "telnyx-verify|telnyx-verify-|0"
  "telnyx-ai|telnyx-ai-assistants-,telnyx-ai-inference-|0"
  "telnyx-numbers|telnyx-numbers-,telnyx-10dlc-,telnyx-porting-|0"
  "telnyx-webrtc|telnyx-webrtc-,telnyx-video-|0"
  "telnyx-platform||1"
)

# Print the plugin that claims a skill name under PLUGIN_PATTERNS.
claude_plugin_for() {
  local skill_name="$1"
  local entry plugin_name prefixes catch_all prefix catch_all_plugin=""
  for entry in "${PLUGIN_PATTERNS[@]}"; do
    IFS='|' read -r plugin_name prefixes catch_all <<< "$entry"
    if [ "$catch_all" = "1" ]; then
      catch_all_plugin="$plugin_name"
      continue
    fi
    IFS=',' read -ra prefix_list <<< "$prefixes"
    for prefix in "${prefix_list[@]}"; do
      if [[ "$skill_name" == "$prefix"* ]]; then
        echo "$plugin_name"
        return
      fi
    done
  done
  echo "$catch_all_plugin"
}
