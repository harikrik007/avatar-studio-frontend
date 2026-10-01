"use client";

import { Suspense } from "react";
import AgentBuilder from "../builder/AgentBuilder";

// Builder in create mode. Suspense: the builder reads ?tab= with useSearchParams.
export default function NewAgentPage() {
  return (
    <Suspense fallback={null}>
      <AgentBuilder />
    </Suspense>
  );
}
