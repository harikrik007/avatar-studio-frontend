"use client";

import { useEffect, useState } from "react";

/**
 * The signed-in account's plan and minutes (app/api/billing -> the backend's GET /billing). `shown` is false while minutes
 * are not switched on (administrators see it first), and then the app shows no Plan page and no banner.
 */
export type BillingSubscription = {
  plan_code: string | null;
  plan_name: string;
  kind: "trial" | "plan" | "unlimited";
  minutes: number;
  calls_at_once: number;
  can_go_live: boolean;
  unlimited: boolean;
  status: string;
  period_start: string | null;
  period_end: string | null;
};

export type BillingMeter = {
  unlimited: boolean;
  included_seconds: number;
  extra_seconds: number;
  allowance_seconds: number;
  used_seconds: number;
  left_seconds: number | null;
  running: number;
};

export type Billing = {
  shown: boolean;
  enforcing?: boolean;
  subscription?: BillingSubscription | null;
  meter?: BillingMeter | null;
  contact?: string | null;
};

const HIDDEN: Billing = { shown: false };
let pending: Promise<Billing> | null = null;

export function loadBilling(fresh = false): Promise<Billing> {
  if (fresh) pending = null;
  pending ??= fetch("/api/billing", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : HIDDEN))
    .then((b) => (b && b.shown === true ? (b as Billing) : HIDDEN))
    .catch(() => HIDDEN);
  return pending;
}

/** Asked once per page load and shared (the layout's nav and banner, the Plan page); `fresh` asks again on mount. */
export function useBilling(fresh = false): Billing | null {
  const [billing, setBilling] = useState<Billing | null>(null);
  useEffect(() => {
    let live = true;
    void loadBilling(fresh).then((b) => {
      if (live) setBilling(b);
    });
    return () => {
      live = false;
    };
  }, [fresh]);
  return billing;
}

/** Whole minutes for the meter: what is used rounds up (a started minute is shown) but never past the allowance (the few
 * seconds a session runs over before it is ended would read "61 of 60"); what is left rounds down. */
export function usedMinutes(m: BillingMeter): number {
  const used = Math.ceil(Math.max(m.used_seconds, 0) / 60);
  return m.unlimited ? used : Math.min(used, allowanceMinutes(m));
}

export function leftMinutes(m: BillingMeter): number {
  return Math.max(Math.floor((m.left_seconds ?? 0) / 60), 0);
}

export function allowanceMinutes(m: BillingMeter): number {
  return Math.round(m.allowance_seconds / 60);
}

/** Share of the minutes used, 0..1 (an unlimited account: 0). */
export function usedShare(m: BillingMeter): number {
  if (m.unlimited || m.allowance_seconds <= 0) return m.unlimited ? 0 : 1;
  return Math.min(Math.max(m.used_seconds / m.allowance_seconds, 0), 1);
}

/** "warn" from 80 % of the minutes, "out" when none are left: what the banner says. */
export function minutesLevel(b: Billing | null): "ok" | "warn" | "out" {
  const m = b?.shown ? b.meter : null;
  if (!m || m.unlimited || !b?.enforcing) return "ok";
  if ((m.left_seconds ?? 0) <= 0) return "out";
  return usedShare(m) >= 0.8 ? "warn" : "ok";
}

export function outOfMinutesText(b: Billing): string {
  const trial = b.subscription?.kind === "trial";
  const head = trial ? "Your trial minutes are used up." : "Your plan's minutes are used up.";
  return b.contact ? `${head} To keep your agents answering, contact us at ${b.contact}.` : head;
}
