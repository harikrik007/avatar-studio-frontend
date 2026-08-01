"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import "../landing.css";
import { inter, jetbrainsMono, spaceGrotesk } from "../landing-fonts";

type QualityCheck = {
  name: string;
  passed: boolean;
  detail: string;
  advisory: boolean;
};

type Avatar = {
  id: string;
  name: string;
  status: "uploading" | "processing" | "quality_check" | "ready" | "failed";
  status_detail: string | null;
  quality_report_json: { passed: boolean; checks: QualityCheck[] } | null;
  preview_video_url: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<Avatar["status"], string> = {
  uploading: "Uploading",
  processing: "Processing",
  quality_check: "Quality check",
  ready: "Ready",
  failed: "Failed",
};

function StatusBadge({ status }: { status: Avatar["status"] }) {
  return <span className={`l-status-badge l-status-${status}`}>{STATUS_LABEL[status]}</span>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DashboardPage() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/avatars");
    if (res.ok) {
      setAvatars(await res.json());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while anything is still processing -- the pipeline runs in the
  // background on the API, this is how the dashboard finds out it finished.
  useEffect(() => {
    const anyInFlight = avatars.some((a) => a.status === "uploading" || a.status === "processing");
    if (!anyInFlight) return;
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [avatars, refresh]);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) return;

    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("name", name.trim());
    form.set("file", file);

    const res = await fetch("/api/avatars", { method: "POST", body: form });
    setBusy(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error || body.detail || "Upload failed.");
      return;
    }

    setName("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    void refresh();
  }

  return (
    <main className={`landing ${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <nav className="l-nav">
        <Link href="/" className="l-brand" style={{ textDecoration: "none", color: "inherit" }}>
          Avatar Studio
        </Link>
        <div className="l-nav-links">
          <Link href="/pricing">Pricing</Link>
        </div>
      </nav>

      <div className="l-dash-shell">
        <div className="l-dash-header">
          <span className="l-kicker">Dashboard</span>
          <h1>Your avatars</h1>
          <p>Upload a 6-second video to create a new one -- creation is free on every plan.</p>
        </div>

        <form className="l-dropzone" onSubmit={submit}>
          <div className="l-field">
            <label htmlFor="avatar-name">Avatar name</label>
            <input
              id="avatar-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Front Desk Assistant"
            />
          </div>

          <div className="l-field">
            <label htmlFor="avatar-file">6-second video (.mp4, .mov, .webm)</label>
            <div
              className={`l-drop-target${dragActive ? " l-drag-active" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
            >
              {file ? (
                <div className="l-drop-file">
                  {file.name} -- {formatBytes(file.size)}
                </div>
              ) : (
                <>
                  <div className="l-drop-title">Drag a video here, or click to browse</div>
                  <div className="l-drop-hint">One person, facing the camera, six seconds long</div>
                </>
              )}
            </div>
            <input
              id="avatar-file"
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
          </div>

          <div className="l-upload-actions">
            <button className="l-btn l-btn-primary" type="submit" disabled={busy || !file || !name.trim()}>
              {busy ? "Uploading..." : "Create avatar"}
            </button>
          </div>
          {error ? <p className="l-error-text">{error}</p> : null}
        </form>

        {avatars.length === 0 ? (
          <div className="l-empty-state">No avatars yet. Upload a video above to create your first one.</div>
        ) : (
          <div className="l-avatar-list">
            {avatars.map((avatar) => (
              <AvatarRow key={avatar.id} avatar={avatar} onDeleted={refresh} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function AvatarRow({ avatar, onDeleted }: { avatar: Avatar; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const checks = avatar.quality_report_json?.checks ?? [];

  async function handleDelete() {
    if (!window.confirm(`Delete "${avatar.name}"? This removes it and its stored video permanently.`)) {
      return;
    }
    setDeleting(true);
    const res = await fetch(`/api/avatars/${avatar.id}`, { method: "DELETE" });
    if (res.ok) {
      onDeleted();
    } else {
      setDeleting(false);
    }
  }

  return (
    <div className="l-avatar-row">
      <div className="l-avatar-row-main">
        {avatar.status === "ready" && avatar.preview_video_url ? (
          <video
            className="l-avatar-thumb"
            src={avatar.preview_video_url}
            muted
            loop
            autoPlay
            playsInline
          />
        ) : (
          <div className="l-avatar-thumb" />
        )}
        <div className="l-avatar-info">
          <div className="l-avatar-name">{avatar.name}</div>
          <div className="l-avatar-meta">{new Date(avatar.created_at).toLocaleString()}</div>
          {avatar.status === "failed" && avatar.status_detail ? (
            <div className="l-quality-detail">{avatar.status_detail}</div>
          ) : null}
          {checks.length > 0 ? (
            <button
              type="button"
              className="l-btn-expand"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide" : "Show"} quality checks ({checks.length})
            </button>
          ) : null}
          {expanded ? (
            <ul className="l-quality-check-list">
              {checks.map((c) => (
                <li key={c.name} className={c.passed ? "l-check-pass" : c.advisory ? "l-advisory" : "l-check-fail"}>
                  {c.passed ? "✓" : c.advisory ? "!" : "✗"} {c.name}
                  {c.advisory ? " (advisory)" : ""}: {c.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="l-avatar-row-actions">
        <StatusBadge status={avatar.status} />
        <button
          type="button"
          className="l-btn-delete"
          onClick={handleDelete}
          disabled={deleting}
          aria-label={`Delete ${avatar.name}`}
        >
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>
  );
}
