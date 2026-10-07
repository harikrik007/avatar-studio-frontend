"use client";

/**
 * The system prompt in a large editor: a native <dialog> opened with showModal() (focus trap, Esc to close and the page
 * behind it inert come from the browser, as in ToolDialog). It edits the SAME value as the small field on the Prompt tab,
 * so there is no draft to apply or lose: what is typed here is in the form at once, and the agent's own Save keeps it.
 */

import { useEffect, useRef } from "react";
import { XIcon } from "./tools/icons";

export default function PromptDialog({
  value,
  onChange,
  onClose,
  agentName,
  caret,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Called with the cursor position in the dialog, so the small field can carry on from the same place. */
  onClose: (caret: number) => void;
  agentName: string;
  /** Where the cursor was in the small field, so the editing carries on from the same place. */
  caret: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // showModal() focuses the first focusable element (the close button); the text is where editing starts
    const t = area.current;
    if (t) {
      const at = Math.min(Math.max(caret, 0), t.value.length);
      t.focus();
      t.setSelectionRange(at, at);
    }
    // only on opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => onClose(area.current?.selectionStart ?? value.length);

  const lines = value ? value.split(String.fromCharCode(10)).length : 0;

  return (
    <dialog
      ref={ref}
      className="lb-dialog lb-dialog-wide"
      aria-labelledby="lb-prompt-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onMouseDown={(e) => {
        // a click on the dim backdrop (the dialog element itself, which has no padding) closes it
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="lb-dialog-inner">
        <header className="lb-dialog-head">
          <div>
            <h2 id="lb-prompt-dialog-title">System prompt</h2>
            <p>
              {agentName.trim() || "Untitled agent"} · Changes apply as you type. Save the agent to keep them.
            </p>
          </div>
          <button type="button" className="lb-icon-btn" aria-label="Close" onClick={close}>
            <XIcon size={16} />
          </button>
        </header>
        <textarea
          ref={area}
          className="lb-input lb-prompt-big"
          aria-label="System prompt"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="You are a friendly front desk assistant for Acme Dental. Help visitors check appointment availability and answer questions about the clinic."
          spellCheck
        />
        <footer className="lb-dialog-foot lb-prompt-foot">
          <span className="lb-count" aria-live="polite">
            {lines.toLocaleString("en-US")} {lines === 1 ? "line" : "lines"} · {value.length.toLocaleString("en-US")} characters
          </span>
          <button type="button" className="l-btn l-btn-primary lb-btn-sm" onClick={close}>
            Done
          </button>
        </footer>
      </div>
    </dialog>
  );
}
