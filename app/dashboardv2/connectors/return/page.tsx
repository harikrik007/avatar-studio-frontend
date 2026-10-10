"use client";

/**
 * Where an owner lands after connecting an app for their agents (the builder's Tools tab opens the app's sign-in in a new
 * tab, and the connector service sends them back here with ?status=success|failed). This tab's only job is to tell the
 * builder, which is still open in the other tab and waiting, and then to get out of the way.
 */

import { useEffect, useState } from "react";
import { CONNECTORS_CHANNEL } from "@/lib/connectors";

export default function ConnectorReturnPage() {
  const [state, setState] = useState<"checking" | "connected" | "failed">("checking");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("status") !== "failed";
    setState(ok ? "connected" : "failed");
    try {
      const channel = new BroadcastChannel(CONNECTORS_CHANNEL);
      channel.postMessage({ app: params.get("app"), status: ok ? "success" : "failed" });
      channel.close();
    } catch {
      // no BroadcastChannel: the builder also checks on its own every few seconds
    }
    // a tab the builder opened can close itself; one opened by hand stays, with the message below
    if (ok) setTimeout(() => window.close(), 1200);
  }, []);

  return (
    <div className="l-dash-shell">
      <div className="l-empty-state" style={{ marginTop: 48 }}>
        {state === "checking" ? (
          <h2>Finishing…</h2>
        ) : state === "connected" ? (
          <>
            <h2>Connected</h2>
            <p>You can close this tab and go back to your agent.</p>
          </>
        ) : (
          <>
            <h2>Not connected</h2>
            <p>The app was not connected. Close this tab and try Connect again from your agent&apos;s Tools.</p>
          </>
        )}
      </div>
    </div>
  );
}
