"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import AgentBuilder from "../builder/AgentBuilder";

// Builder in edit mode. Keyed on the id so switching agents starts clean.
export default function EditAgentPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <Suspense fallback={null}>
      <AgentBuilder key={id} agentId={id} />
    </Suspense>
  );
}
