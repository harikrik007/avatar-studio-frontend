// Gemini Live's voice catalog, mirrored from api/voices.py -- keep both in
// sync by hand, same pattern as this codebase's other cross-repo persona
// duplication. All 24 IDs individually verified against the real Live API
// on 2026-08-03 (see ADDENDUM "Voice selection during agent creation" in
// the plan).
export type VoiceTag = "Male" | "Female" | "British";

export type Voice = {
  id: string;
  descriptor: string;
  tag: VoiceTag;
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
  { id: "Autonoe", descriptor: "Deep, resonant, mature, and thoughtful", tag: "Male" },
  { id: "Sadachbia", descriptor: "Deep voice with a textured, raspy quality", tag: "Male" },
  { id: "Umbriel", descriptor: "Smooth, authoritative, and calm", tag: "Male" },
  { id: "Zubenelgenubi", descriptor: "Powerful, deep, and authoritative", tag: "Male" },
  { id: "Achird", descriptor: "Bright, inquisitive, and youthful", tag: "Female" },
  { id: "Algenib", descriptor: "Warm, confident, mid-range with authority", tag: "Female" },
  { id: "Callirrhoe", descriptor: "Clear, direct, and energetic", tag: "Female" },
  { id: "Despina", descriptor: "Warm, inviting, and smooth", tag: "Female" },
  { id: "Laomedeia", descriptor: "Inquisitive, engaging, and intelligent", tag: "Female" },
  { id: "Pulcherrima", descriptor: "Upbeat, high-pitched, and lively", tag: "Female" },
  { id: "Sulafat", descriptor: "Persuasive, articulate, and confident", tag: "Female" },
  { id: "Vindemiatrix", descriptor: "Calm, mature, composed, and soothing", tag: "Female" },
  { id: "Zephyr", descriptor: "Upbeat, bright, and cheerful", tag: "Female" },
];

export const DEFAULT_VOICE = "Aoede";

export function voiceById(id: string): Voice {
  return VOICE_CATALOG.find((v) => v.id === id) ?? VOICE_CATALOG.find((v) => v.id === DEFAULT_VOICE)!;
}
