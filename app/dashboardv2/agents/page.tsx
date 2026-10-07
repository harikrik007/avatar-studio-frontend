"use client";

/**
 * The Anam dashboard's agent list: one page, one job -- build an agent, test
 * it, embed it. Creating and editing happen in the full-page builder
 * (/dashboardv2/agents/new and /dashboardv2/agents/:id, see builder/); this
 * page only lists the agents and links into it. The old inline create form
 * and edit dialog were replaced by that builder (AGENT_BUILDER_REDESIGN.md).
 *
 * Copied from the v1 (Wav2Lip) agents page rather than shared with it: there,
 * an avatar is something the customer creates from a video; here it is a
 * hosted face picked from a catalogue.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import FlowRail from "../FlowRail";
import { AvatarThumb, RowChevron, SkeletonRows } from "../ui";
import { agentStatusBadgeClass, agentStatusLabel, isPickable, type Agent, type Avatar } from "./shared";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  // Distinguishes "still loading" from "genuinely empty" -- the empty state
  // used to flash on every page load before the first fetch resolved.
  const [loaded, setLoaded] = useState(false);
  const [avatarsLoaded, setAvatarsLoaded] = useState(false);

  // The two lists load independently: the agents are quick, the avatar list can be slow (it once
  // took a minute), and the rows must not wait for it -- their thumbnails fill in when it arrives.
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
      const res = await fetch("/api/avatars");
      if (res.ok) setAvatars(await res.json());
    } catch {
      // thumbnails stay as placeholders
    }
    setAvatarsLoaded(true);
  }, []);

  useEffect(() => {
    void loadAgents();
    void loadAvatars();
  }, [loadAgents, loadAvatars]);

  // Status is server-derived; a provisioning agent is polled until it settles. Only the agents are
  // polled: the avatar list does not change while one provisions.
  useEffect(() => {
    if (!agents.some((a) => a.status === "provisioning")) return;
    const interval = setInterval(loadAgents, 3000);
    return () => clearInterval(interval);
  }, [agents, loadAgents]);

  // The hosted catalogue (see HOSTED_PROVIDERS): shared, always ready, nothing to create.
  const readyAvatars = avatars.filter(isPickable);

  return (
    <div className="l-dash-shell">
      <div className="l-dash-header">
        <span className="l-kicker">Dashboard</span>
        <h1>Agent</h1>
        <p>Pick a face, give it a system prompt and tools, then take it live.</p>
      </div>

      <FlowRail hasAgent={agents.length > 0} hasLiveAgent={agents.some((a) => a.status === "live")} />

      {/* Agents show as soon as they arrive. The empty state alone also needs the avatars (it says
          whether there is anything to build on), so only that case waits for them. */}
      {!loaded || (agents.length === 0 && !avatarsLoaded) ? (
        <SkeletonRows />
      ) : agents.length === 0 ? (
        <div className="l-empty-state">
          {readyAvatars.length === 0 ? (
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
          <div className="l-list-actions">
            <Link href="/dashboardv2/agents/new" className="l-btn l-btn-primary">
              Create agent
            </Link>
          </div>
          <div className="l-avatar-list">
            {agents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} avatars={avatars} avatarsLoaded={avatarsLoaded} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AgentRow({ agent, avatars, avatarsLoaded }: { agent: Agent; avatars: Avatar[]; avatarsLoaded: boolean }) {
  const avatar = avatars.find((a) => a.id === agent.avatar_id);
  return (
    <Link href={`/dashboardv2/agents/${agent.id}`} className="l-avatar-row" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="l-avatar-row-main">
        <AvatarThumb
          src={avatar?.status === "ready" ? avatar.preview_video_url : null}
          imageSrc={avatar?.preview_image_url}
          name={avatar?.name ?? agent.name}
        />
        <div className="l-avatar-info">
          <div className="l-avatar-name">{agent.name}</div>
          <div className="l-avatar-meta">
            {avatar ? avatar.name : avatarsLoaded ? "Unknown avatar" : "…"} — {agent.tools_json.length} tool
            {agent.tools_json.length === 1 ? "" : "s"}
            {agent.documents?.length
              ? ` · ${agent.documents.length} knowledge file${agent.documents.length === 1 ? "" : "s"}`
              : ""}
          </div>
        </div>
      </div>
      <div className="l-avatar-row-end">
        <span className={`l-status-badge ${agentStatusBadgeClass(agent.status)}`}>{agentStatusLabel(agent.status)}</span>
        <RowChevron />
      </div>
    </Link>
  );
}
