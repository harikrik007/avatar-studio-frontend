"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

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
  return <span className={`status-badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

export default function DashboardPage() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <main>
      <nav className="nav">
        <Link href="/" className="brand">
          Avatar Studio
        </Link>
        <div className="nav-links">
          <Link href="/pricing">Pricing</Link>
        </div>
      </nav>

      <div className="dashboard-shell">
        <div className="dashboard-header">
          <h1>Your avatars</h1>
        </div>

        <form className="upload-card" onSubmit={submit}>
          <div className="field">
            <label htmlFor="avatar-name">Avatar name</label>
            <input
              id="avatar-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Front Desk Assistant"
            />
          </div>
          <div className="field">
            <label htmlFor="avatar-file">6-second video (.mp4, .mov, .webm)</label>
            <input
              id="avatar-file"
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <button className="button button-primary" type="submit" disabled={busy || !file || !name.trim()}>
            {busy ? "Uploading..." : "Create avatar"}
          </button>
          {error ? <p className="error-text">{error}</p> : null}
        </form>

        {avatars.length === 0 ? (
          <div className="empty-state">No avatars yet. Upload a video above to create your first one.</div>
        ) : (
          <div className="avatar-list">
            {avatars.map((avatar) => (
              <AvatarRow key={avatar.id} avatar={avatar} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function AvatarRow({ avatar }: { avatar: Avatar }) {
  const failedChecks =
    avatar.quality_report_json?.checks.filter((c) => !c.passed && !c.advisory) ?? [];

  return (
    <div className="avatar-row">
      <div className="avatar-row-main">
        {avatar.status === "ready" && avatar.preview_video_url ? (
          <video
            className="avatar-thumb"
            src={avatar.preview_video_url}
            muted
            loop
            autoPlay
            playsInline
          />
        ) : (
          <div className="avatar-thumb" />
        )}
        <div>
          <div className="avatar-name">{avatar.name}</div>
          <div className="avatar-meta">{new Date(avatar.created_at).toLocaleString()}</div>
          {avatar.status === "failed" && failedChecks.length > 0 ? (
            <div className="quality-detail">{avatar.status_detail}</div>
          ) : null}
        </div>
      </div>
      <StatusBadge status={avatar.status} />
    </div>
  );
}
