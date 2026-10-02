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
  // Indian variants (2026-10-02): the Live API has only the standard voices, so an Indian accent is
  // the standard voice plus an instruction in the system prompt -- the backend adds it for an
  // id ending "-Indian" (api/voices.py). Each preview clip in public/voice-samples was made that
  // way and its pitch checked against the tag. Google's regional library voices (en-in-*) are
  // for the TTS models only: the Live model accepts the ids but does not speak in those voices.
  { id: "Aoede-Indian", name: "Aoede (Indian accent)", descriptor: "Indian English accent. Articulate, thoughtful, and clear", tag: "Female", accent: "Indian" },
  { id: "Kore-Indian", name: "Kore (Indian accent)", descriptor: "Indian English accent. Energetic, youthful, and bright", tag: "Female", accent: "Indian" },
  { id: "Despina-Indian", name: "Despina (Indian accent)", descriptor: "Indian English accent. Warm, inviting, and smooth", tag: "Female", accent: "Indian" },
  { id: "Sulafat-Indian", name: "Sulafat (Indian accent)", descriptor: "Indian English accent. Persuasive, articulate, and confident", tag: "Female", accent: "Indian" },
  { id: "Zephyr-Indian", name: "Zephyr (Indian accent)", descriptor: "Indian English accent. Upbeat, bright, and cheerful", tag: "Female", accent: "Indian" },
  { id: "Puck-Indian", name: "Puck (Indian accent)", descriptor: "Indian English accent. Upbeat, engaging, and friendly", tag: "Male", accent: "Indian" },
  { id: "Charon-Indian", name: "Charon (Indian accent)", descriptor: "Indian English accent. Smooth, reassuring, and confident", tag: "Male", accent: "Indian" },
  { id: "Fenrir-Indian", name: "Fenrir (Indian accent)", descriptor: "Indian English accent. Conversational, direct, and approachable", tag: "Male", accent: "Indian" },
  { id: "Alnilam-Indian", name: "Alnilam (Indian accent)", descriptor: "Indian English accent. Energetic mid-to-low pitch, enthusiastic", tag: "Male", accent: "Indian" },
  { id: "Umbriel-Indian", name: "Umbriel (Indian accent)", descriptor: "Indian English accent. Smooth, authoritative, and calm", tag: "Male", accent: "Indian" },
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
