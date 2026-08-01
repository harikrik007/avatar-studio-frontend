"use client";

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
  return <span className={`l-status-badge l-status-${status}`}>{STATUS_LABEL[status]}</span>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AvatarsPage() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null);
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

  // Keep the open dialog's data in sync with polling -- e.g. a processing
  // avatar the user is looking at flips to ready without them having to
  // close and reopen it.
  useEffect(() => {
    if (!selectedAvatar) return;
    const fresh = avatars.find((a) => a.id === selectedAvatar.id);
    if (fresh && fresh !== selectedAvatar) setSelectedAvatar(fresh);
  }, [avatars, selectedAvatar]);

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

  async function handleDeleteSelected() {
    if (!selectedAvatar) return;
    if (!window.confirm(`Delete "${selectedAvatar.name}"? This removes it and its stored video permanently.`)) {
      return;
    }
    const res = await fetch(`/api/avatars/${selectedAvatar.id}`, { method: "DELETE" });
    if (res.ok) {
      setSelectedAvatar(null);
      void refresh();
    }
  }

  return (
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
            <AvatarRow key={avatar.id} avatar={avatar} onOpen={() => setSelectedAvatar(avatar)} />
          ))}
        </div>
      )}

      <AvatarDialog avatar={selectedAvatar} onClose={() => setSelectedAvatar(null)} onDelete={handleDeleteSelected} />
    </div>
  );
}

function AvatarRow({ avatar, onOpen }: { avatar: Avatar; onOpen: () => void }) {
  return (
    <button type="button" className="l-avatar-row" onClick={onOpen}>
      <div className="l-avatar-row-main">
        {avatar.status === "ready" && avatar.preview_video_url ? (
          <video className="l-avatar-thumb" src={avatar.preview_video_url} muted loop autoPlay playsInline />
        ) : (
          <div className="l-avatar-thumb" />
        )}
        <div className="l-avatar-info">
          <div className="l-avatar-name">{avatar.name}</div>
          <div className="l-avatar-meta">{new Date(avatar.created_at).toLocaleString()}</div>
        </div>
      </div>
      <StatusBadge status={avatar.status} />
    </button>
  );
}

function AvatarDialog({
  avatar,
  onClose,
  onDelete,
}: {
  avatar: Avatar | null;
  onClose: () => void;
  onDelete: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (avatar) {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.close();
      setExpanded(false);
    }
  }, [avatar]);

  const checks = avatar?.quality_report_json?.checks ?? [];

  return (
    <dialog ref={dialogRef} className="l-avatar-dialog" onClose={onClose} onCancel={onClose}>
      {avatar ? (
        <>
          <button type="button" className="l-dialog-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
          {avatar.status === "ready" && avatar.preview_video_url ? (
            <video
              className="l-avatar-dialog-video"
              src={avatar.preview_video_url}
              muted
              loop
              autoPlay
              playsInline
              controls
            />
          ) : (
            <div className="l-avatar-dialog-video l-avatar-dialog-placeholder" />
          )}
          <div className="l-avatar-dialog-body">
            <div className="l-avatar-dialog-header">
              <h2>{avatar.name}</h2>
              <StatusBadge status={avatar.status} />
            </div>
            <div className="l-avatar-meta">Created {new Date(avatar.created_at).toLocaleString()}</div>
            {avatar.status === "failed" && avatar.status_detail ? (
              <div className="l-quality-detail">{avatar.status_detail}</div>
            ) : null}
            {checks.length > 0 ? (
              <>
                <button type="button" className="l-btn-expand" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Hide" : "Show"} quality checks ({checks.length})
                </button>
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
              </>
            ) : null}
            <button type="button" className="l-btn-delete l-dialog-delete" onClick={onDelete}>
              Delete avatar
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
