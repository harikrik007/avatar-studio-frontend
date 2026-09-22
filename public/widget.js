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
  // What the bubble says under the face. A visitor is being invited to
  // talk to a person-shaped thing, so the default reads like an invitation
  // rather than a feature name.
  var label = currentScript.getAttribute("data-label") || "Let's talk";

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

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  var isRight = position.indexOf("right") !== -1;
  var isTop = position.indexOf("top") !== -1;
  var edgeStyle = isRight ? "right:20px;" : "left:20px;";
  var vEdgeStyle = isTop ? "top:20px;" : "bottom:20px;";
  // The avatar's own still, fetched below. Until it arrives (or if it never
  // does) the bubble is the plain icon it has always been -- the widget has
  // to be usable on a slow network and on a key with no avatar preview.
  var avatarUrl = null;

  var CHAT_ICON =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M4 4H20V16H7.5L4 19.5V4Z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>' +
    "</svg>";
  var bubble = document.createElement("button");
  bubble.setAttribute("aria-label", "Open chat");
  bubble.type = "button";
  bubble.onmouseenter = function () { bubble.style.transform = "scale(1.06)"; };
  bubble.onmouseleave = function () { bubble.style.transform = "scale(1)"; };

  function bubbleBaseStyle(round) {
    // Two shapes share one button: a coloured circle holding an icon, and
    // a face with a caption under it. The second is taller, which is why
    // the panel's offset is computed rather than fixed.
    return "position:fixed;" + edgeStyle + vEdgeStyle +
      "border:none;background:" + (round ? accent : "transparent") + ";" +
      (round ? "width:60px;height:60px;border-radius:50%;box-shadow:0 6px 20px rgba(0,0,0,0.25);"
             : "padding:0;border-radius:14px;box-shadow:none;") +
      "cursor:pointer;z-index:2147483000;flex-direction:column;" +
      "display:" + (open ? "none" : "flex") + ";" +
      "align-items:center;justify-content:center;gap:6px;transition:transform 0.15s ease;" +
      "font:600 12px/1 system-ui,-apple-system,'Segoe UI',sans-serif;";
  }

  function renderBubble() {
    // Hidden while open -- the panel carries its own close button, and a
    // second one floating under it was just another way to do the same
    // thing, sitting in the visitor's way.
    var showFace = Boolean(avatarUrl);
    bubble.style.cssText = bubbleBaseStyle(!showFace);
    if (!showFace) {
      bubble.innerHTML = CHAT_ICON;
      return;
    }
    bubble.innerHTML =
      '<img src="' + escapeHtml(avatarUrl) + '" alt="" ' +
      'style="width:64px;height:64px;border-radius:50%;object-fit:cover;display:block;' +
      'border:3px solid #fff;box-shadow:0 6px 20px rgba(0,0,0,0.25);background:#fff;">' +
      '<span style="background:#fff;color:#111;border-radius:999px;padding:5px 12px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,0.18);white-space:nowrap;">' +
      escapeHtml(label) + "</span>";
  }

  // 60px circle vs. 64px face + gap + caption: the panel has to clear
  // whichever is mounted, or it sits on top of the bubble.
  function panelOffset() {
    return avatarUrl ? 124 : 88;
  }

  var frame = null;
  var panelWrap = null;
  var open = false;
  var expanded = false;
  // The panel is a portrait card: a head-and-shoulders avatar plus one
  // action. Expanded is the same card with room to actually see the face.
  var PANEL_W = 340;
  var PANEL_H = 560;
  var PANEL_W_BIG = 420;
  var PANEL_H_BIG = 680;

  function ensureFrame() {
    if (frame) return;

    panelWrap = document.createElement("div");
    panelWrap.style.cssText =
      "position:fixed;" + edgeStyle +
      (isTop ? "top:" : "bottom:") + panelOffset() + "px;" +
      "width:" + PANEL_W + "px;height:" + PANEL_H + "px;" +
      "max-width:calc(100vw - 40px);max-height:calc(100vh - " + (panelOffset() + 24) + "px);" +
      "border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,0.3);" +
      "border:1px solid rgba(0,0,0,0.08);" +
      "z-index:2147483000;display:none;background:#ffffff;transition:width 0.18s ease,height 0.18s ease;";

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
    bubble.setAttribute("aria-label", "Open chat");
    renderBubble();
  }

  bubble.addEventListener("click", function () {
    setOpen(!open);
  });

  // The panel lives in our iframe but is sized and shown by this script, so
  // the frame asks rather than acts. Only messages from that exact frame,
  // from the studio's own origin, are honoured -- any page can postMessage
  // to any window, so the source check is what makes this safe.
  window.addEventListener("message", function (event) {
    if (!frame || event.source !== frame.contentWindow) return;
    if (event.origin !== studioOrigin) return;
    var data = event.data;
    if (!data || data.source !== "avatar-studio-widget") return;
    if (data.type === "close") {
      setOpen(false);
    } else if (data.type === "resize") {
      // The panel asks for width when its transcript column appears. The
      // host page's viewport is the authority, not the request: a phone
      // keeps the card and the panel simply never gets its second column.
      var want = Math.max(260, Math.min(Number(data.width) || PANEL_W, window.innerWidth - 40));
      panelWrap.style.width = want + "px";
    } else if (data.type === "expand") {
      expanded = Boolean(data.expanded);
      panelWrap.style.width = (expanded ? PANEL_W_BIG : PANEL_W) + "px";
      panelWrap.style.height = (expanded ? PANEL_H_BIG : PANEL_H) + "px";
    }
  });

  function loadAvatar() {
    // Never blocks the bubble: it is already on the page by now, and a
    // failure here just leaves the icon in place.
    if (!window.fetch) return;
    window
      .fetch(studioOrigin + "/api/embed/config/" + encodeURIComponent(publicKey))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (config) {
        if (!config || !config.preview_image_url) return;
        var img = new Image();
        // Only swap the icon once the face has actually loaded, so a
        // broken or slow image never leaves an empty hole where the
        // bubble was.
        img.onload = function () {
          avatarUrl = config.preview_image_url;
          renderBubble();
          if (panelWrap) {
            panelWrap.style[isTop ? "top" : "bottom"] = panelOffset() + "px";
          }
        };
        img.src = config.preview_image_url;
      })
      .catch(function () { /* icon stays; nothing to tell the visitor */ });
  }

  function mount() {
    renderBubble();
    document.body.appendChild(bubble);
    loadAvatar();
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
})();
