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
import { HOSTED_PROVIDERS, agentStatusBadgeClass, agentStatusLabel, type Agent, type Avatar } from "./shared";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  // Distinguishes "still loading" from "genuinely empty" -- the empty state
  // used to flash on every page load before the first fetch resolved.
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [agentsRes, avatarsRes] = await Promise.all([fetch("/api/agents"), fetch("/api/avatars")]);
    if (agentsRes.ok) setAgents(await agentsRes.json());
    if (avatarsRes.ok) setAvatars(await avatarsRes.json());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Status is server-derived; a provisioning agent is polled until it settles.
  useEffect(() => {
    if (!agents.some((a) => a.status === "provisioning")) return;
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [agents, refresh]);

  // The hosted catalogue (see HOSTED_PROVIDERS): shared, always ready, nothing to create.
  const readyAvatars = avatars.filter((a) => HOSTED_PROVIDERS.has(a.provider ?? "") && a.status === "ready");

  return (
    <div className="l-dash-shell">
      <div className="l-dash-header">
        <span className="l-kicker">Dashboard</span>
        <h1>Agent</h1>
        <p>Pick a face, give it a system prompt and tools, then take it live.</p>
      </div>

      <FlowRail hasAgent={agents.length > 0} hasLiveAgent={agents.some((a) => a.status === "live")} />

      {!loaded ? (
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
              <AgentRow key={agent.id} agent={agent} avatars={avatars} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AgentRow({ agent, avatars }: { agent: Agent; avatars: Avatar[] }) {
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
            {avatar ? avatar.name : "Unknown avatar"} — {agent.tools_json.length} tool
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
