import type { AgentSdrId } from "@/lib/integrations/agent-sdr";

export const AGENT_SDR_TOOLS = new Set([
  "perform_physical_scan",
  "tone_loopback_visualize",
  "stop_hardware_task",
  "text_fsk_send_and_receive",
  "adaptive_modulation_transmit",
  "auto_optimal_transmit",
  "start_video_stream",
  "stop_video_stream",
  "video_stream_status",
  "search_sdr_knowledge",
]);

export const RIS_AGENT_TOOLS = new Set([
  "scan_point",
  "scan_periodic",
  "scan_area",
  "scan_track",
  "scan_auto_switch",
  "scan_cluster",
  "stop_scan",
  "pause_scan",
  "resume_scan",
  "regular_mode_start",
  "regular_mode_stop",
  "regular_mode_suspend_ris",
  "regular_mode_resume_ris",
  "reset_to_initial_phase",
  "set_default_direction",
  "get_current_locations",
  "get_active_tasks",
  "get_signals",
  "get_regular_mode_state",
  "get_config",
  "get_last_scan_info",
]);

export const resolveToolAgentId = (
  toolName: string,
  fallback: AgentSdrId = "supervisor",
): AgentSdrId => {
  if (RIS_AGENT_TOOLS.has(toolName)) return "ris-agent";
  if (toolName === "search_sdr_knowledge") return "rag";
  if (AGENT_SDR_TOOLS.has(toolName)) return "usrp";
  return fallback;
};
