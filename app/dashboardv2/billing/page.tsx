"use client";

/**
 * Plan: the account's minutes and what its plan includes (2026-10-10, the first slice of results/subscriptions/PLAN.md).
 * Trials and unlimited accounts only for now, so there is no price, payment or invoice here yet. Hidden (and this page says so)
 * while minutes are not switched on; administrators can open it first.
 */

import Link from "next/link";
import "./billing.css";
import {
  allowanceMinutes,
  leftMinutes,
  minutesLevel,
  outOfMinutesText,
  useBilling,
  usedMinutes,
  usedShare,
  type Billing,
} from "@/lib/billing";

const STATUS: Record<string, { label: string; tone: string }> = {
  trialing: { label: "Trial", tone: "l-status-ready" },
  active: { label: "Active", tone: "l-status-ready" },
  past_due: { label: "Payment due", tone: "l-status-processing" },
  suspended: { label: "Suspended", tone: "l-status-failed" },
  cancelled: { label: "Cancelled", tone: "l-status-failed" },
  expired: { label: "Ended", tone: "l-status-failed" },
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function PlanPage() {
  const billing = useBilling(true);

  return (
    <div className="l-dash-shell lpl-shell">
      <div className="l-dash-header">
        <span className="l-kicker">Dashboard</span>
        <h1>Plan</h1>
        <p>Your minutes and what your plan includes.</p>
      </div>
      {billing === null ? (
        <div className="lpl-muted" aria-busy="true">Loading…</div>
      ) : !billing.shown ? (
        <div className="lpl-card lpl-empty">
          <p>There is nothing to show here yet.</p>
          <Link href="/dashboardv2/usage">See your usage</Link>
        </div>
      ) : (
        <PlanCard billing={billing} />
      )}
    </div>
  );
}

function PlanCard({ billing }: { billing: Billing }) {
  const sub = billing.subscription;
  const m = billing.meter;
  if (!sub || !m) {
    return (
      <div className="lpl-card lpl-empty">
        <p>This account has no plan yet.</p>
        {!billing.enforcing ? <p className="lpl-muted">Only administrators see this page until minutes are switched on.</p> : null}
      </div>
    );
  }
  const status = STATUS[sub.status] ?? { label: sub.status, tone: "l-status-processing" };
  const level = minutesLevel(billing);
  const share = usedShare(m);

  return (
    <>
      {!billing.enforcing ? (
        <p className="lpl-preview" role="note">Preview: only administrators see this page until minutes are switched on.</p>
      ) : null}
      <section className="lpl-card" aria-label="Your plan">
        <div className="lpl-top">
          <div>
            <span className="lpl-label">Your plan</span>
            <h2 className="lpl-plan">{sub.plan_name}</h2>
          </div>
          <span className={`l-status-badge ${sub.unlimited ? "l-status-ready" : status.tone}`}>{sub.unlimited ? "Active" : status.label}</span>
        </div>

        {sub.unlimited ? (
          <p className="lpl-big">Unlimited minutes</p>
        ) : (
          <div className="lpl-meter">
            <p className="lpl-big">
              <strong>{usedMinutes(m)}</strong> of {allowanceMinutes(m)} minutes used
            </p>
            <div
              className={`lpl-bar lpl-bar-${level}`}
              role="progressbar"
              aria-label="Minutes used"
              aria-valuemin={0}
              aria-valuemax={allowanceMinutes(m)}
              aria-valuenow={Math.min(usedMinutes(m), allowanceMinutes(m))}
            >
              <span style={{ width: `${Math.round(share * 1000) / 10}%` }} />
            </div>
            <p className={`lpl-left${level === "out" ? " lpl-left-out" : ""}`}>
              {level === "out" ? outOfMinutesText(billing) : `${leftMinutes(m)} minutes left`}
              {m.running > 0 ? <span className="lpl-muted"> · {m.running} session{m.running === 1 ? "" : "s"} running now</span> : null}
            </p>
          </div>
        )}

        <dl className="lpl-facts">
          {!sub.unlimited && m.extra_seconds !== 0 ? (
            <div>
              <dt>Extra minutes</dt>
              <dd>{Math.round(m.extra_seconds / 60)} added to your plan&apos;s {sub.minutes}</dd>
            </div>
          ) : null}
          <div>
            <dt>Sessions at once</dt>
            <dd>{sub.calls_at_once}</dd>
          </div>
          <div>
            <dt>Agents on your website</dt>
            <dd>{sub.can_go_live ? "Yes" : "Not on this trial: try your agents in the builder"}</dd>
          </div>
          {!sub.unlimited ? (
            <div>
              <dt>Minutes counted since</dt>
              <dd>{formatDate(sub.period_start)}</dd>
            </div>
          ) : null}
        </dl>
        <p className="lpl-note">
          Minutes are the length of each session, the same numbers as on <Link href="/dashboardv2/usage">Usage</Link>.
          Test calls in the builder count too.
        </p>
      </section>
    </>
  );
}
