"use client";

/**
 * Phone only: once the call card has scrolled out of view, a bar at the bottom keeps the one thing a visitor can do right there.
 * "Talk to Maya" starts the call (and scrolls the card into view); during a call it says "Back to your call".
 */

import { useEffect, useState } from "react";
import { talk } from "./TalkButton";

export default function StickyTalk({ name, personaKey }: { name: string; personaKey: string }) {
  const [cardVisible, setCardVisible] = useState(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const card = document.getElementById("lh-call");
    if (!card) return;
    const io = new IntersectionObserver(([entry]) => setCardVisible(entry.isIntersecting), { threshold: 0.15 });
    io.observe(card);
    const onCall = (e: Event) => setLive(Boolean((e as CustomEvent<{ live: boolean }>).detail?.live));
    window.addEventListener("landing:call", onCall);
    return () => {
      io.disconnect();
      window.removeEventListener("landing:call", onCall);
    };
  }, []);

  return (
    <div className={`lh-sticky${cardVisible ? "" : " lh-sticky-on"}`} aria-hidden={cardVisible}>
      <button type="button" className="l-btn l-btn-primary" tabIndex={cardVisible ? -1 : 0} onClick={() => talk(personaKey)}>
        {live ? "Back to your call" : `Talk to ${name}`}
      </button>
    </div>
  );
}
