"use client";

/**
 * Form state for the agent builder, shared by create (/agents/new) and edit
 * (/agents/:id). Moved out of the old CreateAgentForm and AgentDialog, which
 * each kept their own copy of the same fields and fetch calls. The request
 * payloads are unchanged:
 *   create  POST  /api/agents          {avatar_id, name, opening_intro, system_prompt, voice, transparent, tools}
 *   save    PATCH /api/agents/:id      {avatar_id, transparent, name, opening_intro, system_prompt, voice, tools}
 *   status  PATCH /api/agents/:id      {status: "live" | "draft"}
 *   delete  DELETE /api/agents/:id
 * Knowledge files upload through /api/agents/:id/documents -- straight away in
 * edit mode (KnowledgeFiles), after the agent exists in create mode.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_VOICE } from "@/lib/voices";
import type { Tool } from "@/lib/tools/model";
import { isPickable, type Agent, type Avatar } from "./shared";

export type AgentFormState = {
  name: string;
  avatarId: string;
  transparent: boolean;
  openingIntro: string;
  systemPrompt: string;
  voice: string;
  tools: Tool[];
};

const EMPTY: AgentFormState = {
  name: "",
  avatarId: "",
  transparent: false,
  openingIntro: "",
  systemPrompt: "",
  voice: DEFAULT_VOICE,
  tools: [],
};

function fromAgent(agent: Agent): AgentFormState {
  return {
    name: agent.name,
    avatarId: agent.avatar_id,
    transparent: Boolean(agent.transparent),
    openingIntro: agent.opening_intro,
    systemPrompt: agent.system_prompt,
    voice: agent.voice,
    tools: agent.tools_json,
  };
}

export function useAgentForm(agentId?: string) {
  const isCreate = !agentId;
  const [agent, setAgent] = useState<Agent | null>(null);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState>(EMPTY);
  // What "clean" means: the server's copy in edit mode, the defaults in create
  // mode. Save is disabled and the leave-page guard is off while form equals it.
  const [baseline, setBaseline] = useState<AgentFormState>(EMPTY);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const pickable = useMemo(
    () => avatars.filter(isPickable),
    [avatars]
  );

  const fetchAgent = useCallback(async (): Promise<Agent | null> => {
    if (!agentId) return null;
    const res = await fetch(`/api/agents/${agentId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Agent;
  }, [agentId]);

  // first load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [avatarsRes, fetched] = await Promise.all([fetch("/api/avatars"), fetchAgent()]);
      if (cancelled) return;
      const list: Avatar[] = avatarsRes.ok ? await avatarsRes.json() : [];
      setAvatars(list);
      if (isCreate) {
        // Same default as the old create form: the first hosted avatar.
        const first = list.find(isPickable);
        const initial = { ...EMPTY, avatarId: first?.id ?? "" };
        setForm(initial);
        setBaseline(initial);
      } else if (fetched) {
        setAgent(fetched);
        const initial = fromAgent(fetched);
        setForm(initial);
        setBaseline(initial);
      } else {
        setLoadError("This agent could not be loaded. It may have been deleted.");
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAgent, isCreate]);

  // Refresh the agent's server-side state (status, embed, documents) without
  // touching the user's unsaved field edits.
  const refreshAgent = useCallback(async () => {
    const fetched = await fetchAgent();
    if (fetched) setAgent(fetched);
    return fetched;
  }, [fetchAgent]);

  // A hosted avatar goes live instantly, but status is server-derived, so a
  // "provisioning" agent is polled until it settles (as the list page did).
  useEffect(() => {
    if (agent?.status !== "provisioning") return;
    const t = setInterval(() => void refreshAgent(), 3000);
    return () => clearInterval(t);
  }, [agent?.status, refreshAgent]);

  const update = useCallback(<K extends keyof AgentFormState>(key: K, value: AgentFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(baseline) || pendingFiles.length > 0,
    [form, baseline, pendingFiles]
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!agentId) return false;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avatar_id: form.avatarId,
        transparent: form.transparent,
        name: form.name,
        opening_intro: form.openingIntro,
        system_prompt: form.systemPrompt,
        voice: form.voice,
        tools: form.tools,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      setError(payload?.detail ?? payload?.error ?? "Couldn't save the agent. Try again shortly.");
      return false;
    }
    setBaseline(form);
    await refreshAgent();
    return true;
  }, [agentId, form, refreshAgent]);

  const setStatus = useCallback(
    async (status: "live" | "draft"): Promise<boolean> => {
      if (!agentId) return false;
      setBusy(true);
      setStatusError(null);
      const res = await fetch(`/api/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setBusy(false);
      if (!res.ok) {
        // The proxy forwards FastAPI's raw body, so the message is under
        // `detail` (no avatar serving configured, every slot in use, ...).
        const payload = await res.json().catch(() => null);
        setStatusError(payload?.detail ?? "Couldn't change this agent's live status. Try again shortly.");
        return false;
      }
      await refreshAgent();
      return true;
    },
    [agentId, refreshAgent]
  );

  /** Create mode. Returns the new agent's id, or null (error is set). */
  const create = useCallback(async (): Promise<{ id: string | null; warning?: string }> => {
    if (!form.avatarId || !form.name.trim()) return { id: null };
    setBusy(true);
    setError(null);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avatar_id: form.avatarId,
        name: form.name.trim(),
        opening_intro: form.openingIntro,
        system_prompt: form.systemPrompt,
        voice: form.voice,
        transparent: form.transparent,
        tools: form.tools,
      }),
    });
    if (!res.ok) {
      setBusy(false);
      const body = await res.json().catch(() => ({}));
      setError(body.error || body.detail || "Couldn't create the agent.");
      return { id: null };
    }
    const created = await res.json().catch(() => null);
    // Documents need an agent id, so they upload after the row exists. A
    // failure is reported but does not discard the agent -- it was created,
    // and the file can be added again from the builder.
    let warning: string | undefined;
    if (created?.id) {
      for (const file of pendingFiles) {
        const fd = new FormData();
        fd.append("file", file);
        const docRes = await fetch(`/api/agents/${created.id}/documents`, { method: "POST", body: fd });
        if (!docRes.ok) {
          const body = await docRes.json().catch(() => ({}));
          warning = `Agent created, but ${file.name} could not be added: ${
            body.detail || body.error || "upload failed"
          }. You can add it from the Prompt tab.`;
          break;
        }
      }
    }
    setPendingFiles([]);
    setBaseline(form);
    setBusy(false);
    return { id: created?.id ?? null, warning };
  }, [form, pendingFiles]);

  const remove = useCallback(async (): Promise<boolean> => {
    if (!agentId) return false;
    const res = await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
    return res.ok;
  }, [agentId]);

  const selectedAvatar = pickable.find((a) => a.id === form.avatarId) ?? avatars.find((a) => a.id === form.avatarId);

  return {
    isCreate,
    agent,
    avatars,
    pickable,
    selectedAvatar,
    loaded,
    loadError,
    form,
    update,
    dirty,
    pendingFiles,
    setPendingFiles,
    busy,
    error,
    setError,
    statusError,
    save,
    setStatus,
    create,
    remove,
    refreshAgent,
  };
}

export type AgentForm = ReturnType<typeof useAgentForm>;
