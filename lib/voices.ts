// Gemini Live's voice catalog, mirrored from api/voices.py -- keep both in
// sync by hand, same pattern as this codebase's other cross-repo persona
// duplication. All 24 IDs individually verified against the real Live API
// on 2026-08-03 (see ADDENDUM "Voice selection during agent creation" in
// the plan).
export type VoiceTag = "Male" | "Female" | "British";
export type VoiceAccent = "Indian";
export type VoiceFilter = VoiceTag | VoiceAccent | "All";

export type Voice = {
  id: string;
  // Shown instead of the id when the id is not a name (library voices).
  name?: string;
  descriptor: string;
  tag: VoiceTag;
  accent?: VoiceAccent;
};

export const VOICE_CATALOG: Voice[] = [
  { id: "Puck", descriptor: "Upbeat, engaging, and friendly", tag: "Male" },
  { id: "Charon", descriptor: "Smooth, reassuring, and confident", tag: "Male" },
  { id: "Kore", descriptor: "Energetic, youthful, and bright", tag: "Female" },
  { id: "Fenrir", descriptor: "Conversational, direct, and approachable", tag: "Male" },
  { id: "Aoede", descriptor: "Articulate, thoughtful, and clear", tag: "Female" },
  { id: "Lyra", descriptor: "Bright, light, and enthusiastic", tag: "Female" },
  { id: "Orion", descriptor: "Confident, warm, and clear", tag: "Male" },
  { id: "Capella", descriptor: "Serene, calm, and articulate", tag: "British" },
  { id: "Ursa", descriptor: "Engaged, clear, and balanced", tag: "Female" },
  { id: "Dipper", descriptor: "Grounded, steady, and clear", tag: "Male" },
  { id: "Alnilam", descriptor: "Energetic mid-to-low pitch, enthusiastic", tag: "Male" },
  { id: "Autonoe", descriptor: "Deep, resonant, mature, and thoughtful", tag: "Female" },
  { id: "Sadachbia", descriptor: "Deep voice with a textured, raspy quality", tag: "Male" },
  { id: "Umbriel", descriptor: "Smooth, authoritative, and calm", tag: "Male" },
  { id: "Zubenelgenubi", descriptor: "Powerful, deep, and authoritative", tag: "Male" },
  { id: "Achird", descriptor: "Bright, inquisitive, and youthful", tag: "Male" },
  { id: "Algenib", descriptor: "Warm, confident, mid-range with authority", tag: "Male" },
  { id: "Callirrhoe", descriptor: "Clear, direct, and energetic", tag: "Female" },
  { id: "Despina", descriptor: "Warm, inviting, and smooth", tag: "Female" },
  { id: "Laomedeia", descriptor: "Inquisitive, engaging, and intelligent", tag: "Female" },
  { id: "Pulcherrima", descriptor: "Upbeat, high-pitched, and lively", tag: "Female" },
  { id: "Sulafat", descriptor: "Persuasive, articulate, and confident", tag: "Female" },
  { id: "Vindemiatrix", descriptor: "Calm, mature, composed, and soothing", tag: "Female" },
  { id: "Zephyr", descriptor: "Upbeat, bright, and cheerful", tag: "Female" },
  // Indian English voices from Google's Extended Voice Library (2026-10-02): ids, not names,
  // so `name` is Google's own display name. They exist only on gemini-3.8-live (and the 3.8
  // TTS models) -- gemini-3.1-flash-live-preview rejects them. Each was checked on 3.8 and has
  // a preview clip in public/voice-samples. Picked from 120 by persona and description.
  { id: "en-in-assistant-3", name: "Digital Assistant 3", descriptor: "Indian English, warm and engaging", tag: "Female", accent: "Indian" },
  { id: "en-in-concierge-3", name: "Concierge 3", descriptor: "Indian English, professional yet approachable", tag: "Female", accent: "Indian" },
  { id: "en-in-csagent-5", name: "Call Center Agent 5", descriptor: "Indian English, clear and friendly", tag: "Female", accent: "Indian" },
  { id: "en-in-csagent-3", name: "Call Center Agent 3", descriptor: "Indian English, confident and clear, mature", tag: "Female", accent: "Indian" },
  { id: "en-in-assistant-8", name: "Digital Assistant 8", descriptor: "Indian English, crisp and eager, youthful", tag: "Female", accent: "Indian" },
  { id: "en-in-assistant-1", name: "Digital Assistant 1", descriptor: "Indian English, engaging and empathic", tag: "Male", accent: "Indian" },
  { id: "en-in-csagent-1", name: "Call Center Agent 1", descriptor: "Indian English, natural and clear", tag: "Male", accent: "Indian" },
  { id: "en-in-concierge-1", name: "Concierge 1", descriptor: "Indian English, warm and engaging", tag: "Male", accent: "Indian" },
  { id: "en-in-techagent-11", name: "Tech Advisor 11", descriptor: "Indian English, confident and clear", tag: "Male", accent: "Indian" },
  { id: "en-in-concierge-8", name: "Concierge 8", descriptor: "Indian English, bright and youthful", tag: "Male", accent: "Indian" },
];

export const VOICE_FILTERS: VoiceFilter[] = ["All", "Male", "Female", "British", "Indian"];

export function voiceName(voice: Voice): string {
  return voice.name ?? voice.id;
}

export function matchesVoiceFilter(voice: Voice, filter: VoiceFilter): boolean {
  return filter === "All" || voice.tag === filter || voice.accent === filter;
}

export const DEFAULT_VOICE = "Aoede";

export function voiceById(id: string): Voice {
  return VOICE_CATALOG.find((v) => v.id === id) ?? VOICE_CATALOG.find((v) => v.id === DEFAULT_VOICE)!;
}
