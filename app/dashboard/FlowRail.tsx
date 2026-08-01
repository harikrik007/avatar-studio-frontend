"use client";

// The product is three steps -- video in, agent built, agent live -- but
// nothing in the dashboard said so, so a first-time user landed on "Your
// avatars" with no idea an agent was even the point. This rail is the only
// place that states the shape of the flow, so it sits on both pages.

const STEPS = ["Create avatar", "Build agent", "Go live"] as const;

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2.5 6.3 4.8 8.6 9.5 3.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function FlowRail({
  hasAvatar,
  hasAgent,
  hasLiveAgent,
}: {
  hasAvatar: boolean;
  hasAgent: boolean;
  hasLiveAgent: boolean;
}) {
  const done = [hasAvatar, hasAgent, hasLiveAgent];
  // The first step that isn't done is the one the user is on. If all three
  // are done there is no current step -- nothing should look unfinished.
  const currentIndex = done.indexOf(false);

  return (
    <ol className="l-flow-rail">
      {STEPS.map((label, i) => {
        const state = done[i] ? "done" : i === currentIndex ? "current" : "pending";
        return (
          <li key={label} className={`l-flow-step l-flow-${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="l-flow-marker">{done[i] ? <CheckIcon /> : i + 1}</span>
            <span className="l-flow-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
