"use client";

/**
 * The Anam dashboard's agent list: one page, one job -- build an agent, test
 * it, embed it. Creating and editing happen in the full-page builder
 * (/dashboardv2/agents/new and /dashboardv2/agents/:id, see builder/); this
 * page only lists the agents and links into it. The old inline create form
 * and edit dialog were replaced by that builder (AGENT_BUILDER_REDESIGN.md).
 *
 * Each agent is a card, two to a row (2026-10-10): its face, large, with the
 * status on it; the avatar and voice; what it has (tools, knowledge files, its
 * shape); how much it was used in the last 30 days (the Usage page's numbers);
 * and Test, Embed code and Edit, which all open the builder.
 *
 * Copied from the v1 (Wav2Lip) agents page rather than shared with it: there,
 * an avatar is something the customer creates from a video; here it is a
 * hosted face picked from a catalogue.
 */

import "./agents.css";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import FlowRail from "../FlowRail";
import { initials } from "../ui";
import { VOICE_CATALOG, voiceName } from "@/lib/voices";
import { formatCount, minutesValue, rangeLastDays, tzOffsetMinutes, usageQuery, type UsageSummary } from "@/lib/usage";
import { agentStatusLabel, avatarLabel, isPickable, type Agent, type Avatar } from "./shared";

/** Sessions and seconds per agent id over the last 30 days. undefined while it loads, null when it could not be read. */
type UsageByAgent = Record<string, { calls: number; call_seconds: number }> | null | undefined;
type StatusFilter = "all" | "live" | "draft";

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "live", label: "Live" },
  { value: "draft", label: "Draft" },
];
// Search and the Live / Draft filter are only worth their row once the list is longer than a screen of cards.
const FILTER_FROM = 7;

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  // Distinguishes "still loading" from "genuinely empty" -- the empty state
  // used to flash on every page load before the first fetch resolved.
  const [loaded, setLoaded] = useState(false);
  const [avatarsLoaded, setAvatarsLoaded] = useState(false);
  const [usage, setUsage] = useState<UsageByAgent>(undefined);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  // The lists load independently: the agents are quick, the avatar list can be slow (it once
  // took a minute), and the cards must not wait for it -- their faces fill in when it arrives.
  // The list never shows a system prompt, so the lean form is asked for.
  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents?summary=true");
      if (res.ok) setAgents(await res.json());
    } catch {
      // keep what is on screen; the next poll or reload tries again
    }
    setLoaded(true);
  }, []);

  const loadAvatars = useCallback(async () => {
    try {
      // The featured faces (and any library face an agent uses), plus how many the avatar library offers: the empty state
      // says there is nothing to build on only when both are empty.
      const [res, lib] = await Promise.all([fetch("/api/avatars"), fetch("/api/avatars/library?per_page=1").catch(() => null)]);
      if (res.ok) setAvatars(await res.json());
      if (lib?.ok) setLibraryTotal(Number((await lib.json())?.counts?.all ?? 0));
    } catch {
      // faces stay as placeholders
    }
    setAvatarsLoaded(true);
  }, []);

  // One request for every card's usage line: the Usage page's own numbers, grouped by agent, in the viewer's days.
  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch(`/api/usage/summary${usageQuery({ ...rangeLastDays(30), tz: tzOffsetMinutes(), group_by: "agent" })}`);
      if (!res.ok) return setUsage(null);
      const body: UsageSummary = await res.json();
      setUsage(Object.fromEntries(body.groups.filter((g) => g.key).map((g) => [g.key as string, { calls: g.calls, call_seconds: g.call_seconds }])));
    } catch {
      setUsage(null);
    }
  }, []);

  useEffect(() => {
    void loadAgents();
    void loadAvatars();
    void loadUsage();
  }, [loadAgents, loadAvatars, loadUsage]);

  // Status is server-derived; a provisioning agent is polled until it settles. Only the agents are
  // polled: the avatar list does not change while one provisions.
  useEffect(() => {
    if (!agents.some((a) => a.status === "provisioning")) return;
    const interval = setInterval(loadAgents, 3000);
    return () => clearInterval(interval);
  }, [agents, loadAgents]);

  // The hosted catalogue (see HOSTED_PROVIDERS): shared, always ready, nothing to create.
  const readyAvatars = avatars.filter(isPickable);
  const nothingToBuildOn = readyAvatars.length === 0 && libraryTotal === 0;

  const liveCount = agents.filter((a) => a.status === "live").length;
  const canFilter = agents.length >= FILTER_FROM;
  const q = query.trim().toLowerCase();
  const shown = !canFilter ? agents : agents.filter((a) => {
    // an agent that is starting is on its way to live
    if (filter === "live" && a.status === "draft") return false;
    if (filter === "draft" && a.status !== "draft") return false;
    if (!q) return true;
    const avatar = avatars.find((v) => v.id === a.avatar_id);
    return a.name.toLowerCase().includes(q) || (avatar ? avatarLabel(avatar).toLowerCase().includes(q) : false);
  });
  const filtering = canFilter && (q !== "" || filter !== "all");

  return (
    <div className="l-dash-shell la-shell">
      <KeyFilter />
      <div className="la-head">
        <div className="l-dash-header">
          <span className="l-kicker">Dashboard</span>
          <h1>Agents</h1>
          {loaded && agents.length > 0 ? (
            <p className="la-count">
              {formatCount(agents.length)} agent{agents.length === 1 ? "" : "s"} · {formatCount(liveCount)} live
            </p>
          ) : (
            <p>Pick a face, give it a system prompt and tools, then take it live.</p>
          )}
        </div>
        {loaded && agents.length > 0 ? (
          <Link href="/dashboardv2/agents/new" className="l-btn l-btn-primary la-create">
            <PlusIcon />
            Create agent
          </Link>
        ) : null}
      </div>

      {/* The two steps are for getting the first agent live; once one is, both are ticked and the bar says nothing. */}
      {loaded && liveCount === 0 ? <FlowRail hasAgent={agents.length > 0} hasLiveAgent={false} /> : null}

      {/* Agents show as soon as they arrive. The empty state alone also needs the avatars (it says
          whether there is anything to build on), so only that case waits for them. */}
      {!loaded || (agents.length === 0 && !avatarsLoaded) ? (
        <SkeletonCards />
      ) : agents.length === 0 ? (
        <div className="l-empty-state">
          {nothingToBuildOn ? (
            <>
              <h2>No avatars available</h2>
              <p>
                The hosted avatar catalogue hasn&apos;t been set up on this environment yet. Once it is, you can
                build an agent here without creating anything first.
              </p>
            </>
          ) : (
            <>
              <h2>No agents yet</h2>
              <p>
                An agent is one of these faces given a system prompt and a set of tools, so it can hold a live
                conversation on your behalf.
              </p>
              <Link href="/dashboardv2/agents/new" className="l-btn l-btn-primary">
                Create agent
              </Link>
            </>
          )}
        </div>
      ) : (
        <>
          {canFilter ? (
            <div className="la-tools">
              <label className="la-search">
                <span className="la-sr">Search agents</span>
                <SearchIcon />
                <input type="search" value={query} placeholder="Search agents" aria-label="Search agents"
                  onChange={(e) => setQuery(e.target.value)} />
              </label>
              <div className="la-seg" role="group" aria-label="Status">
                {FILTERS.map((f) => (
                  <button key={f.value} type="button" aria-pressed={filter === f.value}
                    className={`la-seg-btn${filter === f.value ? " la-seg-on" : ""}`} onClick={() => setFilter(f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {shown.length === 0 ? (
            <div className="l-empty-state la-no-match">
              <h2>No agents match</h2>
              <p>Try another name, or show all of them.</p>
            </div>
          ) : (
            <div className="la-grid">
              {shown.map((agent) => (
                <AgentCard key={agent.id} agent={agent} avatar={avatars.find((a) => a.id === agent.avatar_id)}
                  avatarsLoaded={avatarsLoaded} usage={usage} />
              ))}
              {filtering ? null : (
                <Link href="/dashboardv2/agents/new" className="la-new">
                  <PlusIcon />
                  New agent
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AgentCard({ agent, avatar, avatarsLoaded, usage }: { agent: Agent; avatar?: Avatar; avatarsLoaded: boolean; usage: UsageByAgent }) {
  const [hover, setHover] = useState(false);
  const href = `/dashboardv2/agents/${agent.id}`;
  const voice = VOICE_CATALOG.find((v) => v.id === agent.voice);
  const voiceText = voice ? voiceName(voice) : agent.voice;
  const tools = agent.tools_json.length;
  const files = agent.documents?.length ?? 0;
  const used = usage ? usage[agent.id] : undefined;
  const clip = avatar?.status === "ready" ? avatar.preview_video_url : null;

  return (
    <article className="la-card" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <div className="la-face">
        {avatar?.preview_image_url ? (
          // A face shot on a green screen is shown cut out, on the card's own backdrop (see KeyFilter).
          <img className={avatar.supports_transparency ? "la-keyed" : undefined} src={avatar.preview_image_url} alt="" />
        ) : clip ? (
          <video src={clip} muted loop autoPlay playsInline />
        ) : (
          <span className="la-face-fallback" aria-hidden="true">{initials(avatar?.name ?? agent.name)}</span>
        )}
        {/* a face with both a still and a clip: the clip plays while the pointer is on the card */}
        {hover && clip && avatar?.preview_image_url ? <video className="la-clip" src={clip} muted loop autoPlay playsInline /> : null}
        <span className={`la-status la-status-${agent.status}`}>
          <span className="la-dot" aria-hidden="true" />
          {agentStatusLabel(agent.status)}
        </span>
      </div>
      <div className="la-body">
        <h2 className="la-name">
          <Link href={href} className="la-main-link">{agent.name}</Link>
        </h2>
        <p className="la-sub">
          {avatar ? avatarLabel(avatar) : avatarsLoaded ? "Unknown avatar" : "…"} · {voiceText}
          {voiceText.includes("(") ? "" : " voice"}
        </p>
        <ul className="la-chips">
          <li>{tools} tool{tools === 1 ? "" : "s"}</li>
          {files > 0 ? <li>{files} knowledge file{files === 1 ? "" : "s"}</li> : null}
          <li>{agent.orientation === "landscape" ? "Landscape" : "Portrait"}</li>
          {agent.transparent ? <li>Frameless</li> : null}
        </ul>
        {usage === null ? null : (
          <p className="la-usage" aria-busy={usage === undefined}>
            {usage === undefined ? (
              <span className="l-skeleton la-usage-wait" />
            ) : used && used.calls > 0 ? (
              <>
                <strong>{formatCount(used.calls)}</strong> session{used.calls === 1 ? "" : "s"} · <strong>{minutesValue(used.call_seconds)}</strong> min
                <span className="la-when"> · last 30 days</span>
              </>
            ) : (
              "No sessions in the last 30 days"
            )}
          </p>
        )}
        <div className="la-actions">
          <Link href={`${href}?test=1`} className="la-btn">Test</Link>
          <Link href={`${href}?tab=embed`} className="la-btn">Embed code</Link>
          <Link href={href} className="la-edit" aria-label={`Edit ${agent.name}`}>
            Edit
            <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3.5 8h9M8.5 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>
    </article>
  );
}

/**
 * The cut-out for green-screen faces, as an SVG filter the cards' <img> point at (a filter works on another site's image,
 * which a canvas could not read). Opacity falls with how much greener a pixel is than its red and blue; the cut-out's edge
 * is then trimmed by about a pixel, where a green rim would show against the dark card. Colours are left alone: pulling
 * green towards neutral turns reds orange. Tried on the real stills: results/agents-page-redesign/keying-test.
 */
function KeyFilter() {
  return (
    <svg width="0" height="0" className="la-defs" aria-hidden="true">
      <filter id="la-key" colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  7 -14 7 0 2.4" result="keyed" />
        <feMorphology in="keyed" operator="erode" radius="1" result="thin" />
        <feGaussianBlur in="thin" stdDeviation="0.4" result="soft" />
        <feComposite in="keyed" in2="soft" operator="in" />
      </filter>
    </svg>
  );
}

// Shown instead of blank space (and instead of a wrong "nothing here yet") while the first fetch is still in flight.
function SkeletonCards() {
  return (
    <div className="la-grid" aria-hidden="true">
      {[0, 1].map((i) => (
        <div className="la-card la-card-wait" key={i}>
          <div className="la-face l-skeleton" />
          <div className="la-body">
            <span className="l-skeleton l-skeleton-line" />
            <span className="l-skeleton l-skeleton-line l-skeleton-line-short" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="7" cy="7" r="4.2" />
      <path d="m10.2 10.2 3 3" strokeLinecap="round" />
    </svg>
  );
}
