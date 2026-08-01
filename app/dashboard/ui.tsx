"use client";

// Small pieces shared by both dashboard pages, so a row, a thumbnail, and a
// busy button look the same wherever they appear.

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function AvatarThumb({ src, name }: { src?: string | null; name: string }) {
  if (src) {
    return <video className="l-avatar-thumb" src={src} muted loop autoPlay playsInline />;
  }
  return (
    <span className="l-avatar-thumb l-avatar-thumb-fallback" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

// The dialog's video slot has the same problem the rows had: with no preview
// to play it was a large black rectangle.
export function DialogPlaceholder({ name }: { name: string }) {
  return (
    <div className="l-avatar-dialog-video l-avatar-dialog-placeholder">
      <span className="l-dialog-initials" aria-hidden="true">
        {initials(name)}
      </span>
    </div>
  );
}

export function RowChevron() {
  return (
    <svg
      className="l-row-chevron"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="m6 3.5 5 4.5-5 4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner() {
  return <span className="l-spinner" aria-hidden="true" />;
}

// Shown instead of blank space (and instead of a wrong "nothing here yet")
// while the first fetch is still in flight.
export function SkeletonRows({ count = 2 }: { count?: number }) {
  return (
    <div className="l-avatar-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div className="l-avatar-row l-skeleton-row" key={i}>
          <div className="l-avatar-row-main">
            <span className="l-avatar-thumb l-skeleton" />
            <div className="l-avatar-info">
              <span className="l-skeleton l-skeleton-line" />
              <span className="l-skeleton l-skeleton-line l-skeleton-line-short" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
