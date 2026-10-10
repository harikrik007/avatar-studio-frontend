"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import TranscriptDialog from "./TranscriptDialog";
import {
  endReasonLabel,
  formatClock,
  formatCount,
  formatSeconds,
  formatStarted,
  kindLabel,
  shortOrigin,
  statusBadgeClass,
  statusLabel,
  type UsageItem,
} from "@/lib/usage";

export const PAGE_SIZES = [10, 25, 50, 100];

/**
 * The Usage page's sessions, one page at a time: agent, start, minutes, status and type, each with a quiet second line
 * (the session's short ID, how it ended, the page it ran on). A row opens its details; its ⋯ menu also offers the transcript.
 */
export default function SessionsTable({
  items, total, page, pageSize, onPage, onPageSize,
}: {
  items: UsageItem[];
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<UsageItem | null>(null);
  const now = new Date();

  useEffect(() => setOpen(null), [items]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  return (
    <>
      <div className="lu-table-wrap lu-sessions-wrap">
        <table className="lu-table lu-calls">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Started</th>
              <th className="lu-num">Minutes</th>
              <th>Status</th>
              <th>Type</th>
              <th className="lu-menu-col"><span className="lu-sr">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const started = formatStarted(c.started_at, now);
              const isOpen = open === c.id;
              const toggle = () => setOpen(isOpen ? null : c.id);
              return (
                <Fragment key={c.id}>
                  <tr className={`lu-row${isOpen ? " lu-row-open" : ""}`} onClick={toggle}>
                    <td>
                      <button type="button" className="lu-expand" aria-expanded={isOpen}
                        aria-label={`Details for the session started ${started}`}
                        onClick={(e) => { e.stopPropagation(); toggle(); }}>
                        {c.agent_name ?? "(deleted agent)"}
                      </button>
                      <div className="lu-sub lu-mono">{c.id.slice(0, 8)}</div>
                    </td>
                    <td className="lu-nowrap" title={c.started_at ? new Date(c.started_at).toLocaleString() : undefined}>{started}</td>
                    <td className="lu-num">{formatClock(c.call_seconds)}</td>
                    <td>
                      <span className={`l-status-badge ${statusBadgeClass(c.status)}`}>{statusLabel(c.status)}</span>
                      <div className="lu-sub">{c.status === "active" ? "Still running" : endReasonLabel(c.end_reason)}</div>
                    </td>
                    <td>
                      <div>{kindLabel(c.kind)}</div>
                      <div className="lu-sub lu-ellipsis" title={c.origin ?? undefined}>
                        {c.kind === "embed" ? shortOrigin(c.origin) || "Widget" : "Dashboard"}
                      </div>
                    </td>
                    <td className="lu-menu-col" onClick={(e) => e.stopPropagation()}>
                      <RowMenu started={started} detailsOpen={isOpen} onDetails={toggle} onTranscript={() => setTranscript(c)} />
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="lu-detail-row">
                      <td colSpan={6}><SessionDetail call={c} onTranscript={() => setTranscript(c)} /></td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="lu-pager" role="navigation" aria-label="Pages">
        <span className="lu-pager-range">{formatCount(first)} – {formatCount(last)} of {formatCount(total)}</span>
        <div className="lu-pager-right">
          <label className="lu-pager-size">
            <span>Rows per page</span>
            <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <span className="lu-pager-page">Page {formatCount(page + 1)} of {formatCount(pages)}</span>
          <div className="lu-pager-btns">
            <PageBtn label="First page" disabled={page === 0} onClick={() => onPage(0)}>«</PageBtn>
            <PageBtn label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>‹</PageBtn>
            <PageBtn label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>›</PageBtn>
            <PageBtn label="Last page" disabled={page >= pages - 1} onClick={() => onPage(pages - 1)}>»</PageBtn>
          </div>
        </div>
      </div>
      {transcript ? <TranscriptDialog call={transcript} onClose={() => setTranscript(null)} /> : null}
    </>
  );
}

function PageBtn({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="lu-page-btn" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

/** The ⋯ on a row: View details and View transcript, in a small menu that opens under the button (above it near the
 * bottom of the window). Esc or a click outside closes it. */
function RowMenu({ started, detailsOpen, onDetails, onTranscript }: {
  started: string; detailsOpen: boolean; onDetails: () => void; onTranscript: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pos) return;
    menu.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null);
    };
    const shut = () => setPos(null);
    document.addEventListener("pointerdown", away);
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("scroll", shut, true);
      window.removeEventListener("resize", shut);
    };
  }, [pos]);

  function toggle() {
    if (pos) { setPos(null); return; }
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 96 > window.innerHeight;
    setPos({ top: up ? r.top - 88 : r.bottom + 4, left: Math.max(8, r.right - 168) });
  }

  function done(fn: () => void) {
    setPos(null);
    btn.current?.focus();
    fn();
  }

  function onKey(e: React.KeyboardEvent) {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); setPos(null); btn.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
  }

  return (
    <>
      <button ref={btn} type="button" className="lu-dots" aria-haspopup="menu" aria-expanded={pos !== null}
        aria-label={`Actions for the session started ${started}`} onClick={toggle}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" /><circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
      </button>
      {pos ? (
        <div ref={menu} className="lu-menu lu-row-menu" role="menu" style={{ top: pos.top, left: pos.left }} onKeyDown={onKey}>
          <button type="button" role="menuitem" className="lu-menu-item" onClick={() => done(onDetails)}>
            {detailsOpen ? "Hide details" : "View details"}
          </button>
          <button type="button" role="menuitem" className="lu-menu-item" onClick={() => done(onTranscript)}>
            View transcript
          </button>
        </div>
      ) : null}
    </>
  );
}

// The flags a session's owner is told about; anything else on it (an administrator's own notes) is not shown here.
const FLAG_LABELS: Record<string, string> = { failed: "Failed", lost: "Lost" };

function SessionDetail({ call, onTranscript }: { call: UsageItem; onTranscript: () => void }) {
  const flags = call.flags.filter((f) => f in FLAG_LABELS);
  return (
    <div className="lu-detail">
      <dl className="lu-facts">
        <div><dt>How it ended</dt><dd>{call.status === "active" ? "Still running" : endReasonLabel(call.end_reason)}</dd></div>
        <div><dt>Session length</dt><dd>{formatSeconds(call.duration_seconds)}</dd></div>
        <div><dt>Voice</dt><dd>{call.voice ?? "—"}</dd></div>
        {call.origin ? <div><dt>Page</dt><dd>{call.origin}</dd></div> : null}
        <div><dt>Tool calls</dt><dd>{formatCount(call.tool_calls)}</dd></div>
        <div><dt>Session ID</dt><dd className="lu-mono">{call.id}</dd></div>
        <div>
          <dt>Transcript</dt>
          <dd>
            <button type="button" className="l-btn l-btn-ghost lu-transcript-btn" onClick={onTranscript}>
              View transcript
            </button>
          </dd>
        </div>
      </dl>
      {flags.length > 0 ? (
        <div className="lu-flags">{flags.map((f) => <span key={f} className="lu-flag">{FLAG_LABELS[f]}</span>)}</div>
      ) : null}
    </div>
  );
}
