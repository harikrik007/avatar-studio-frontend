"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { VOICE_CATALOG, type VoiceTag } from "@/lib/voices";

const FILTERS: (VoiceTag | "All")[] = ["All", "Male", "Female", "British"];

// Its own dialog, layered on top of whichever agent form opened it (see
// that form's compact voice row) -- never an inline panel, so the agent
// form's own height never changes whether voice is untouched or being
// actively browsed.
export function VoicePickerDialog({
  open,
  currentVoice,
  onSelect,
  onClose,
}: {
  open: boolean;
  currentVoice: string;
  onSelect: (voiceId: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [filter, setFilter] = useState<VoiceTag | "All">("All");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  // Portaled to document.body rather than rendered in place: this dialog is
  // opened from AgentDialog/CreateAgentForm, which is itself a native
  // <dialog> when editing an existing agent. Two native <dialog> elements
  // nested in the DOM (not just visually layered) is a real, reproduced
  // bug -- closing the inner one also fires a close event on the outer
  // one, silently discarding the whole agent form. Portaling makes this
  // dialog a DOM *sibling* of the outer one instead of a descendant.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
      audioRef.current?.pause();
      setPlayingId(null);
    }
  }, [open]);

  const visible = filter === "All" ? VOICE_CATALOG : VOICE_CATALOG.filter((v) => v.tag === filter);

  function togglePlay(voiceId: string) {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingId === voiceId) {
      audio.pause();
      setPlayingId(null);
      return;
    }
    audio.src = `/voice-samples/${voiceId}.wav`;
    void audio.play();
    setPlayingId(voiceId);
  }

  function select(voiceId: string) {
    audioRef.current?.pause();
    setPlayingId(null);
    onSelect(voiceId);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, visible.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const v = visible[focusedIndex];
      if (v) select(v.id);
    } else if (e.key === " ") {
      e.preventDefault();
      const v = visible[focusedIndex];
      if (v) togglePlay(v.id);
    }
  }

  if (!mounted) return null;

  return createPortal(
    <dialog ref={dialogRef} className="l-voice-picker" onClose={onClose} onCancel={onClose}>
      <button type="button" className="l-dialog-close" onClick={onClose} aria-label="Close">
        &times;
      </button>
      <div className="l-voice-picker-body">
        <h3>Choose a voice</h3>

        <div className="l-voice-filters" role="tablist" aria-label="Filter voices">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={`l-voice-filter-pill${filter === f ? " l-voice-filter-active" : ""}`}
              onClick={() => {
                setFilter(f);
                setFocusedIndex(0);
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <div
          className="l-voice-list"
          role="listbox"
          aria-label="Voices"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {visible.map((voice, i) => {
            const isPlaying = playingId === voice.id;
            const isCurrent = currentVoice === voice.id;
            return (
              <div
                key={voice.id}
                role="option"
                aria-selected={isCurrent}
                className={`l-voice-row${isCurrent ? " l-voice-row-current" : ""}${
                  i === focusedIndex ? " l-voice-row-focused" : ""
                }`}
                onClick={() => select(voice.id)}
              >
                <button
                  type="button"
                  className={`l-voice-play${isPlaying ? " l-voice-play-active" : ""}`}
                  aria-label={isPlaying ? `Stop preview of ${voice.id}` : `Preview ${voice.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePlay(voice.id);
                  }}
                >
                  {isPlaying ? (
                    <span className="l-voice-eq" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                      <path d="M2 1.5v9l8-4.5-8-4.5z" fill="currentColor" />
                    </svg>
                  )}
                </button>
                <div className="l-voice-info">
                  <span className="l-voice-name">
                    {voice.id}
                    {isCurrent ? <span className="l-voice-current-tag">Current</span> : null}
                  </span>
                  <span className="l-voice-descriptor">{voice.descriptor}</span>
                </div>
                <span className="l-voice-tag">{voice.tag}</span>
              </div>
            );
          })}
        </div>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} />
    </dialog>,
    document.body
  );
}
