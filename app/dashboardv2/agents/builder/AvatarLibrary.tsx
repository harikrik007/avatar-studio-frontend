"use client";

/**
 * The avatar library in the builder's Avatar tab (2026-10-08): the built-in faces, after the featured ones, one page at a time
 * from /api/avatars/library -- searched with the tab's own search box, filtered by look, and opening on the page that holds the
 * agent's face when that face is one of them. Only the page on screen is fetched, so 120 faces cost one page of pictures.
 */

import { useEffect, useRef, useState } from "react";
import { LIBRARY_STYLES, avatarTake, isPickable, type Avatar } from "../shared";

export const LIBRARY_PER_PAGE = 24;

type LibraryPage = { items: Avatar[]; total: number; page: number; per_page: number; pages: number; counts: Record<string, number> };
// What is asked for. A new object for every request, so asking for the page already asked for (after `around` moved the view)
// still fetches.
type Want = { page: number; q: string; style: string; around?: string };

export function AvatarLibrary({
  query,
  selectedId,
  startAround,
  onPick,
  whenEmpty = null,
}: {
  query: string;
  selectedId: string;
  /** The agent's own face, when it is a library face: the library opens on its page. */
  startAround?: string;
  onPick: (a: Avatar) => void;
  /** Shown instead of the section when this environment's library is empty. */
  whenEmpty?: React.ReactNode;
}) {
  const [want, setWant] = useState<Want>(() => ({ page: 1, q: query.trim(), style: "", around: startAround }));
  const [data, setData] = useState<LibraryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const scrollOnLoad = useRef(false);

  // The search box is the tab's: a pause in typing searches the library too, from its first page.
  useEffect(() => {
    const q = query.trim();
    if (q === want.q) return;
    const t = setTimeout(() => setWant((w) => ({ page: 1, q, style: w.style })), 250);
    return () => clearTimeout(t);
  }, [query, want.q]);

  useEffect(() => {
    const ctrl = new AbortController();
    const params = new URLSearchParams({ page: String(want.page), per_page: String(LIBRARY_PER_PAGE) });
    if (want.q) params.set("q", want.q);
    if (want.style) params.set("style", want.style);
    if (want.around) params.set("around", want.around);
    setLoading(true);
    fetch(`/api/avatars/library?${params}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setData((await res.json()) as LibraryPage);
        setFailed(false);
        setLoading(false);
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        void e;
        setFailed(true);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [want]);

  // A page picked at the bottom of the grid starts at the top of the library, not mid-way down the new page. "Above" is
  // measured against whatever scrolls the library (the builder's left panel), not the window.
  useEffect(() => {
    if (!scrollOnLoad.current || loading) return;
    scrollOnLoad.current = false;
    const el = topRef.current;
    if (!el) return;
    const top = scrollerOf(el)?.getBoundingClientRect().top ?? 0;
    if (el.getBoundingClientRect().top < top) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [loading]);

  const go = (page: number) => {
    scrollOnLoad.current = true;
    setWant((w) => ({ page, q: w.q, style: w.style }));
  };
  const counts = data?.counts ?? {};
  const items = (data?.items ?? []).filter(isPickable);

  // An environment whose library is empty (never synced): no section at all.
  if (!loading && !failed && data && !want.q && !want.style && (counts.all ?? 0) === 0) return <>{whenEmpty}</>;

  return (
    <div className="lb-lib" ref={topRef}>
      <div className="lb-lib-head">
        <span className="lb-group-label">Avatar library</span>
        {data ? <span className="lb-lib-count">{counts.all ?? 0} {want.q ? ((counts.all ?? 0) === 1 ? "match" : "matches") : "avatars"}</span> : null}
      </div>
      <div className="l-voice-filters lb-lib-styles" role="group" aria-label="Look">
        {LIBRARY_STYLES.map((s) => {
          const on = want.style === s.value;
          const n = counts[s.value || "all"];
          return (
            <button
              key={s.value || "all"}
              type="button"
              aria-pressed={on}
              className={`l-voice-filter-pill${on ? " l-voice-filter-active" : ""}`}
              onClick={() => setWant((w) => ({ page: 1, q: w.q, style: s.value }))}
            >
              {s.label}
              {n !== undefined ? <span className="lb-lib-chip-n">{n}</span> : null}
            </button>
          );
        })}
      </div>
      {failed ? (
        <p className="lb-help">
          The avatar library could not be loaded.{" "}
          <button type="button" className="lb-link" onClick={() => setWant((w) => ({ ...w }))}>
            Try again
          </button>
        </p>
      ) : (
        <div className={`lb-avatar-grid${loading && data ? " lb-lib-loading" : ""}`} role="radiogroup" aria-label="Avatar library" aria-busy={loading}>
          {!data
            ? Array.from({ length: 6 }, (_, i) => <div key={i} className="lb-avatar-card lb-skeleton" aria-hidden="true" />)
            : items.map((a) => <AvatarCard key={a.id} avatar={a} selected={a.id === selectedId} onSelect={() => onPick(a)} lazy />)}
        </div>
      )}
      {data && !failed && data.total === 0 ? (
        <p className="lb-help">{want.q ? "No avatar in the library matches that name." : "No avatar in the library has that look."}</p>
      ) : null}
      {data && !failed && data.pages > 1 ? <Pager page={data.page} pages={data.pages} total={data.total} perPage={data.per_page} onGo={go} /> : null}
    </div>
  );
}

function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const y = getComputedStyle(n).overflowY;
    if ((y === "auto" || y === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/** 1 … 4 5 6 … 10: the first and last pages, and the ones either side of this one. */
export function pageList(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => keep.add(n));
  const out: (number | "gap")[] = [];
  let last = 0;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - last > 1) out.push("gap");
    out.push(n);
    last = n;
  }
  return out;
}

function Pager({ page, pages, total, perPage, onGo }: { page: number; pages: number; total: number; perPage: number; onGo: (p: number) => void }) {
  const from = (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  return (
    <div className="lb-pager-wrap">
      <nav className="lb-pager" aria-label="Avatar library pages">
        <button type="button" className="lb-pager-btn" disabled={page <= 1} onClick={() => onGo(page - 1)} aria-label="Previous page">
          ‹ Prev
        </button>
        {pageList(page, pages).map((n, i) =>
          n === "gap" ? (
            <span key={`gap-${i}`} className="lb-pager-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              className={`lb-pager-btn lb-pager-num${n === page ? " lb-pager-on" : ""}`}
              aria-current={n === page ? "page" : undefined}
              aria-label={`Page ${n}`}
              onClick={() => onGo(n)}
            >
              {n}
            </button>
          )
        )}
        <button type="button" className="lb-pager-btn" disabled={page >= pages} onClick={() => onGo(page + 1)} aria-label="Next page">
          Next ›
        </button>
      </nav>
      <span className="lb-pager-range">
        {from}–{to} of {total}
      </span>
    </div>
  );
}

export function AvatarCard({ avatar, selected, onSelect, lazy }: { avatar: Avatar; selected: boolean; onSelect: () => void; lazy?: boolean }) {
  const take = avatarTake(avatar);
  return (
    <button type="button" role="radio" aria-checked={selected} className={`lb-avatar-card${selected ? " lb-avatar-selected" : ""}`} onClick={onSelect}>
      {avatar.preview_image_url ? (
        <img className="lb-avatar-img" src={avatar.preview_image_url} alt="" loading={lazy ? "lazy" : undefined} decoding="async" />
      ) : (
        <span className="lb-avatar-img lb-avatar-initial" aria-hidden="true">
          {avatar.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="lb-avatar-name" title={take ? `${avatar.name} · ${take}` : avatar.name}>
        {avatar.name}
      </span>
      {take ? <span className="lb-avatar-take">{take}</span> : null}
      {avatar.supports_transparency ? (
        <span className="lb-badge-green" title="Shot against a green screen — can be shown with no background">
          TRANSPARENT READY
        </span>
      ) : null}
    </button>
  );
}
