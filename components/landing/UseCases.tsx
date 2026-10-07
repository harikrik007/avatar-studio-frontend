"use client";

/**
 * Use cases as tabs by job. Each shows what the agent does, a short example conversation (invented, and labelled as an example),
 * and either a "Talk to ..." button, when a published persona matches the job, or a "Build one like this" link.
 */

import Link from "next/link";
import { useState } from "react";
import { USE_CASES } from "@/lib/landing-content";
import type { LandingPersona } from "@/lib/personas";
import { talk } from "./TalkButton";

export default function UseCases({ personas }: { personas: LandingPersona[] }) {
  const [id, setId] = useState(USE_CASES[0].id);
  const current = USE_CASES.find((u) => u.id === id) ?? USE_CASES[0];
  const persona = personas.find((p) => current.match.some((m) => `${p.role} ${p.name}`.toLowerCase().includes(m)));

  return (
    <div className="lh-uc">
      <div className="lh-uc-tabs" role="tablist" aria-label="Use cases">
        {USE_CASES.map((u) => (
          <button key={u.id} type="button" role="tab" id={`uc-tab-${u.id}`} aria-selected={u.id === id} aria-controls="uc-panel" className={`lh-uc-tab${u.id === id ? " lh-uc-on" : ""}`} onClick={() => setId(u.id)}>
            {u.label}
          </button>
        ))}
      </div>
      <div className="lh-uc-panel" id="uc-panel" role="tabpanel" aria-labelledby={`uc-tab-${current.id}`}>
        <div>
          <h3>{current.label}</h3>
          <p className="lh-uc-outcome">{current.outcome}</p>
          {persona ? (
            <button type="button" className="l-btn l-btn-primary" onClick={() => talk(persona.key)}>
              Talk to {persona.name}
            </button>
          ) : (
            <Link href="/dashboardv2" className="l-btn l-btn-ghost">
              Build one like this
            </Link>
          )}
        </div>
        <div className="lh-chat">
          <span className="lh-chat-label">Example conversation</span>
          <p className="lh-chat-v">{current.visitor}</p>
          <p className="lh-chat-a">{current.agent}</p>
        </div>
      </div>
    </div>
  );
}
