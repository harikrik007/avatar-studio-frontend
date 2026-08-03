/**
 * Avatar Studio embeddable widget loader.
 *
 * Dependency-free, no build step, no framework -- this is the one file
 * that runs inside a stranger's page, so it has to be safe to drop
 * anywhere: it never touches host-page globals or stylesheets beyond the
 * one bubble element it creates, and everything the widget actually does
 * (LiveKit, React, the avatar) lives inside an iframe, fully isolated.
 *
 * Usage:
 *   <script src="https://<studio-domain>/widget.js" data-key="pk_live_..."
 *           data-position="bottom-right" data-accent="#0f8f7b"></script>
 *
 * The iframe is created lazily, on first click -- the host page pays
 * nothing (no LiveKit bundle, no extra requests) until a visitor actually
 * opens the widget. Open/close state lives here in the parent page's own
 * DOM; the iframe is just the panel content (see app/embed/[key]/page.tsx),
 * which is why there's no postMessage needed for that -- CSS visibility on
 * an element this script itself owns is simpler and cannot be spoofed by
 * the iframe's own (cross-origin) content.
 */
(function () {
  "use strict";

  // Safe to include this tag twice by accident (a CMS re-rendering a
  // header partial, a customer copy-pasting the snippet into two places) --
  // the second load is a silent no-op rather than a second bubble.
  if (window.__avatarStudioWidgetLoaded) return;
  window.__avatarStudioWidgetLoaded = true;

  var currentScript = document.currentScript;
  if (!currentScript) return; // nothing to configure from -- fail silent, never break the host page

  var publicKey = currentScript.getAttribute("data-key");
  if (!publicKey) {
    console.error("[avatar-studio widget] missing data-key attribute -- widget not loaded.");
    return;
  }

  var position = currentScript.getAttribute("data-position") || "bottom-right";
  var accent = currentScript.getAttribute("data-accent") || "#0f8f7b";

  // The studio's own origin, derived from where this very script was
  // fetched from -- never hardcoded, so the same file works on staging,
  // production, or a future domain without edits.
  var studioOrigin;
  try {
    studioOrigin = new URL(currentScript.src).origin;
  } catch (e) {
    console.error("[avatar-studio widget] could not resolve studio origin.", e);
    return;
  }

  var isRight = position.indexOf("right") !== -1;
  var isTop = position.indexOf("top") !== -1;
  var edgeStyle = isRight ? "right:20px;" : "left:20px;";
  var vEdgeStyle = isTop ? "top:20px;" : "bottom:20px;";
  var panelVEdge = isTop ? "top:88px;" : "bottom:88px;";

  var bubble = document.createElement("button");
  bubble.setAttribute("aria-label", "Open chat");
  bubble.type = "button";
  bubble.style.cssText =
    "position:fixed;" + edgeStyle + vEdgeStyle +
    "width:60px;height:60px;border-radius:50%;border:none;" +
    "background:" + accent + ";box-shadow:0 6px 20px rgba(0,0,0,0.25);" +
    "cursor:pointer;z-index:2147483000;display:flex;align-items:center;justify-content:center;" +
    "transition:transform 0.15s ease;";
  bubble.onmouseenter = function () { bubble.style.transform = "scale(1.06)"; };
  bubble.onmouseleave = function () { bubble.style.transform = "scale(1)"; };
  bubble.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 4H20V16H7.5L4 19.5V4Z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>' +
    "</svg>";

  var frame = null;
  var panelWrap = null;
  var open = false;

  function ensureFrame() {
    if (frame) return;

    panelWrap = document.createElement("div");
    panelWrap.style.cssText =
      "position:fixed;" + edgeStyle + panelVEdge +
      "width:300px;height:420px;max-width:calc(100vw - 40px);max-height:calc(100vh - 120px);" +
      "border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.28);" +
      "z-index:2147483000;display:none;background:#ffffff;";

    frame = document.createElement("iframe");
    frame.src = studioOrigin + "/embed/" + encodeURIComponent(publicKey);
    // Mic capture inside a cross-origin iframe needs an explicit
    // Permissions Policy delegation -- this is that grant. It only works
    // if the host page itself is HTTPS and its own Permissions-Policy (if
    // any) does not already block "microphone" from being delegated
    // further; that is a host-page configuration issue this script cannot
    // fix, only document (see the install instructions).
    frame.setAttribute("allow", "microphone");
    frame.style.cssText = "width:100%;height:100%;border:0;display:block;";
    frame.title = "Chat widget";

    panelWrap.appendChild(frame);
    document.body.appendChild(panelWrap);
  }

  function setOpen(next) {
    open = next;
    ensureFrame();
    panelWrap.style.display = open ? "block" : "none";
    bubble.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    bubble.innerHTML = open
      ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M5 5L19 19M19 5L5 19" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>'
      : '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M4 4H20V16H7.5L4 19.5V4Z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  }

  bubble.addEventListener("click", function () {
    setOpen(!open);
  });

  function mount() {
    document.body.appendChild(bubble);
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
})();
