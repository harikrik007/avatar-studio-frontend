"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FlowRail from "../FlowRail";
import { AvatarThumb, DialogPlaceholder, RowChevron, SkeletonRows, Spinner } from "../ui";

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

// Mirrors MAX_UPLOAD_BYTES and the extension check in api/main.py, so an
// oversized or wrong-typed file is rejected here instead of after a long
// upload that the backend was always going to refuse.
const MAX_UPLOAD_MB = 200;
const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".webm"];

function rejectReason(file: File): string | null {
  if (!ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    return "That file type isn't supported. Use an MP4, MOV, or WebM video.";
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `That video is ${formatBytes(file.size)}. The limit is ${MAX_UPLOAD_MB} MB.`;
  }
  return null;
}

// Only what the flow rail needs -- this page never renders an agent, it just
// has to know whether any exist and whether one is live.
type AgentSummary = { id: string; status: "draft" | "live" };

export default function AvatarsPage() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  // Distinguishes "still loading" from "genuinely empty" -- the empty state
  // used to flash on every page load before the first fetch resolved.
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitState, setSubmitState] = useState<"idle" | "uploading" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState<Avatar | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [avatarsRes, agentsRes] = await Promise.all([fetch("/api/avatars"), fetch("/api/agents")]);
    if (avatarsRes.ok) setAvatars(await avatarsRes.json());
    if (agentsRes.ok) setAgents(await agentsRes.json());
    setLoaded(true);
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

  // The list below is the durable confirmation; this line is just the
  // acknowledgement of the click, so it retires itself.
  useEffect(() => {
    if (submitState !== "done") return;
    const timer = setTimeout(() => setSubmitState("idle"), 6000);
    return () => clearTimeout(timer);
  }, [submitState]);

  // Single gate for both the drop target and the hidden file input, so a bad
  // file is caught the same way however it arrives.
  const chooseFile = useCallback((candidate: File | null) => {
    if (!candidate) {
      setFile(null);
      return;
    }
    const reason = rejectReason(candidate);
    if (reason) {
      setError(reason);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setError(null);
    setFile(candidate);
  }, []);

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    chooseFile(e.dataTransfer.files?.[0] ?? null);
  }

  // XMLHttpRequest rather than fetch purely for upload progress -- fetch has
  // no equivalent of xhr.upload.onprogress. Note this measures the browser ->
  // Next.js leg; the route handler then forwards to the API, so the bar
  // reaching 100% means "sent", after which the avatar sits in Processing.
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !name.trim() || submitState === "uploading") return;

    setSubmitState("uploading");
    setProgress(0);
    setError(null);

    const form = new FormData();
    form.set("name", name.trim());
    form.set("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/avatars");

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setSubmitState("done");
        setName("");
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        void refresh();
        return;
      }
      let message = "Upload failed. Try again.";
      try {
        const body = JSON.parse(xhr.responseText);
        message = body.error || body.detail || message;
      } catch {
        // non-JSON error body (a proxy timeout page, say) -- keep the default
      }
      setError(message);
      setSubmitState("idle");
    };

    xhr.onerror = () => {
      setError("Upload failed. Check your connection and try again.");
      setSubmitState("idle");
    };

    xhr.send(form);
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

  const uploading = submitState === "uploading";
  const canSubmit = !uploading && !!file && !!name.trim();
  // Say what's actually missing rather than leaving a dead button unexplained.
  const missingHint =
    !name.trim() && !file
      ? "Add a name and a video first."
      : !name.trim()
        ? "Add a name first."
        : !file
          ? "Add a video first."
          : null;

  return (
    <div className="l-dash-shell">
      <div className="l-dash-header">
        <span className="l-kicker">Dashboard</span>
        <h1>Your avatars</h1>
        <p>Upload a 6-second video. Creating an avatar is free.</p>
      </div>

      <FlowRail
        hasAvatar={avatars.some((a) => a.status === "ready")}
        hasAgent={agents.length > 0}
        hasLiveAgent={agents.some((a) => a.status === "live")}
      />

      <form className="l-dropzone" onSubmit={submit}>
        <div className="l-field">
          <label htmlFor="avatar-name">Avatar name</label>
          <input
            id="avatar-name"
            ref={nameInputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Front Desk Assistant"
          />
        </div>

        <div className="l-field">
          <label htmlFor="avatar-file">Video</label>
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
                {file.name} — {formatBytes(file.size)}
              </div>
            ) : (
              <div className="l-drop-title">Drag a video here, or click to browse</div>
            )}
          </div>
          <p className="l-helper-text">
            MP4, MOV, or WebM. One person facing the camera, about 6 seconds long, up to {MAX_UPLOAD_MB} MB.
          </p>
          <input
            id="avatar-file"
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
            style={{ display: "none" }}
          />
        </div>

        <div className="l-upload-actions">
          <button className="l-btn l-btn-primary" type="submit" disabled={!canSubmit}>
            {uploading ? (
              <>
                <Spinner />
                Creating…
              </>
            ) : (
              "Create avatar"
            )}
          </button>
          {!uploading && missingHint ? <span className="l-helper-text">{missingHint}</span> : null}
        </div>

        {uploading ? (
          <>
            <div
              className="l-progress"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="l-progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <p className="l-helper-text">Uploading video — {progress}%</p>
          </>
        ) : null}

        {submitState === "done" ? (
          <p className="l-success-text">Avatar created. We're processing it now — it'll appear below.</p>
        ) : null}
        {error ? <p className="l-error-text">{error}</p> : null}
      </form>

      {!loaded ? (
        <SkeletonRows />
      ) : avatars.length === 0 ? (
        <div className="l-empty-state">
          <h2>No avatars yet</h2>
          <p>An avatar is a face built from one short video. It takes under a minute, and creation is free.</p>
          <button
            type="button"
            className="l-btn l-btn-primary"
            onClick={() => {
              nameInputRef.current?.scrollIntoView({ block: "center" });
              nameInputRef.current?.focus();
            }}
          >
            Create your first avatar
          </button>
        </div>
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
        <AvatarThumb
          src={avatar.status === "ready" ? avatar.preview_video_url : null}
          name={avatar.name}
        />
        <div className="l-avatar-info">
          <div className="l-avatar-name">{avatar.name}</div>
          <div className="l-avatar-meta">{new Date(avatar.created_at).toLocaleString()}</div>
        </div>
      </div>
      <div className="l-avatar-row-end">
        <StatusBadge status={avatar.status} />
        <RowChevron />
      </div>
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
            <DialogPlaceholder name={avatar.name} />
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
