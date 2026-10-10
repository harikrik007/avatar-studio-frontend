"use client";

import { useEffect, useRef, useState } from "react";
import { PERIODS, formatDayRange, type PeriodId } from "@/lib/usage";

/**
 * The Usage page's time choice: one dropdown with the usual ranges and "Custom range…", which opens From and To dates in the
 * same panel. The two dates stay in order and never pass today. Closes on a choice, Esc or a click outside it.
 */
export default function RangePicker({
  period, from, to, today, onPreset, onCustom,
}: {
  period: PeriodId | "custom";
  from: string;
  to: string;
  today: string;
  onPreset: (id: PeriodId) => void;
  onCustom: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const label = period === "custom" ? formatDayRange(from, to) : PERIODS.find((p) => p.id === period)?.label ?? "";

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // the chosen line takes the focus when the list opens, so the arrow keys start from it
  useEffect(() => {
    if (open && !custom) list.current?.querySelector<HTMLButtonElement>("[aria-selected='true']")?.focus();
  }, [open, custom]);

  function close(refocus: boolean) {
    setOpen(false);
    setCustom(false);
    if (refocus) trigger.current?.focus();
  }

  function openCustom() {
    setDraftFrom(from);            // start from what is on screen, so the inputs are never empty
    setDraftTo(to);
    setCustom(true);
  }

  function pickFrom(v: string) {
    if (!v) return;
    const day = v > today ? today : v;
    setDraftFrom(day);
    if (day > draftTo) setDraftTo(day);
  }

  function pickTo(v: string) {
    if (!v) return;
    const day = v > today ? today : v;
    setDraftTo(day);
    if (day < draftFrom) setDraftFrom(day);
  }

  function onListKey(e: React.KeyboardEvent) {
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === "ArrowDown") { e.preventDefault(); go(at + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); go(at - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(items.length - 1); }
  }

  return (
    <div className="lu-range-picker" ref={box} onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(true); } }}>
      <button ref={trigger} type="button" className="lu-dropdown-btn" aria-haspopup="listbox" aria-expanded={open}
        aria-label={`Time range: ${label}`} onClick={() => (open ? close(false) : setOpen(true))}>
        <span>{label}</span>
        <Chevron />
      </button>
      {open ? (
        <div className="lu-menu lu-range-menu">
          {custom ? (
            <div className="lu-custom" role="group" aria-label="Custom range">
              <label className="lu-date">
                <span>From</span>
                <input type="date" value={draftFrom} max={today} aria-label="From date" onChange={(e) => pickFrom(e.target.value)} />
              </label>
              <label className="lu-date">
                <span>To</span>
                <input type="date" value={draftTo} max={today} aria-label="To date" onChange={(e) => pickTo(e.target.value)} />
              </label>
              <div className="lu-custom-actions">
                <button type="button" className="lu-menu-plain" onClick={() => setCustom(false)}>Back</button>
                <button type="button" className="l-btn l-btn-primary lu-apply"
                  onClick={() => { onCustom(draftFrom, draftTo); close(true); }}>
                  Apply
                </button>
              </div>
            </div>
          ) : (
            <div role="listbox" aria-label="Time range" ref={list} onKeyDown={onListKey}>
              {PERIODS.map((p) => (
                <button key={p.id} type="button" role="option" aria-selected={period === p.id} className="lu-menu-item"
                  onClick={() => { onPreset(p.id); close(true); }}>
                  {p.label}
                </button>
              ))}
              <div className="lu-menu-sep" role="separator" />
              <button type="button" role="option" aria-selected={period === "custom"} className="lu-menu-item" onClick={openCustom}>
                Custom range…
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function Chevron() {
  return (
    <svg className="lu-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
