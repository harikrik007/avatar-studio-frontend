"use client";

import { useEffect, useState } from "react";

/** Features the signed-in account may see (app/api/features): asked once per page load; everything off until the answer comes. */
export type Features = { voiceIsolation: boolean };

const NONE: Features = { voiceIsolation: false };
let pending: Promise<Features> | null = null;

function load(): Promise<Features> {
  pending ??= fetch("/api/features", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : NONE))
    .then((f) => ({ voiceIsolation: f?.voiceIsolation === true }))
    .catch(() => NONE);
  return pending;
}

export function useFeatures(): Features {
  const [features, setFeatures] = useState<Features>(NONE);
  useEffect(() => {
    let live = true;
    void load().then((f) => {
      if (live) setFeatures(f);
    });
    return () => {
      live = false;
    };
  }, []);
  return features;
}
