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
  // The same still, background keyed out, for a frameless agent's closed
  // bubble -- a small cutout floating with no circle around it, the same
  // composition the open panel uses at full size. Separate from avatarUrl
  // because the two bubbles are different shapes, not just different
  // images.
  var transparentAvatarUrl = null;
  // Smaller than the open panel's full figure on purpose -- this is a
  // preview, not the conversation itself.
  var CLOSED_FRAMELESS_H = 150;

  // Ports the same green-key math the open panel's WebGL shader uses
  // (components/green-screen-canvas.tsx) to a plain 2-D canvas. A
  // per-pixel JS loop is exactly what that shader exists to avoid for a
  // live 25fps video track -- but this runs once, against one still image,
  // where the simplest correct tool is the right one.
  function keyGreenScreenStill(img, done) {
    var MIN_GREEN = 90, GREEN_BIAS = 1.15, SOFTNESS = 28, SPILL = 0.45;
    var keyRamp = Math.max(8, SOFTNESS * 0.55);
    try {
      var canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      var frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var px = frame.data;
      for (var i = 0; i < px.length; i += 4) {
        var r = px[i], g = px[i + 1], b = px[i + 2];
        var maxC = Math.max(r, g, b);
        var minC = Math.min(r, g, b);
        var sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
        var greenDominance = g - Math.max(r, b);
        var isGreen = g === maxC && g > MIN_GREEN && g > r * GREEN_BIAS &&
          g > b * GREEN_BIAS && sat > 0.08 && greenDominance > 2;
        if (isGreen) {
          var keyedAmount = Math.min(1, Math.max(0,
            (greenDominance - 2) / keyRamp + (sat - 0.08) * 1.8));
          px[i + 3] = Math.round(px[i + 3] * (1 - keyedAmount));
        } else if (greenDominance > 8 && g > 70) {
          px[i + 1] = Math.max(0, g - greenDominance * SPILL);
        }
      }
      ctx.putImageData(frame, 0, 0);
      done(canvas.toDataURL("image/png"));
    } catch (e) {
      // A tainted canvas (the still served without CORS) throws on
      // getImageData -- fall back to the original, unkeyed still rather
      // than leaving the bubble empty.
      done(null);
    }
  }

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
    var showing = open ? "none" : "flex";

    if (frameless && transparentAvatarUrl) {
      // No circle, no ring, no background of any colour: the keyed cutout
      // standing directly on the host page, the same composition the open
      // panel uses at full size, just smaller -- a preview of who is about
      // to talk, not the conversation itself.
      bubble.style.cssText =
        "position:fixed;" + edgeStyle + vEdgeStyle +
        "border:none;background:transparent;padding:0;box-shadow:none;" +
        "cursor:pointer;z-index:2147483000;flex-direction:column;display:" + showing + ";" +
        "align-items:center;justify-content:center;gap:8px;transition:transform 0.15s ease;" +
        "font:600 12px/1 system-ui,-apple-system,'Segoe UI',sans-serif;";
      bubble.innerHTML =
        '<img src="' + escapeHtml(transparentAvatarUrl) + '" alt="" ' +
        'style="height:' + CLOSED_FRAMELESS_H + 'px;width:auto;display:block;' +
        'filter:drop-shadow(0 10px 22px rgba(0,0,0,0.35));">' +
        '<span style="background:#fff;color:#111;border-radius:999px;padding:5px 12px;' +
        'box-shadow:0 4px 14px rgba(0,0,0,0.18);white-space:nowrap;">' +
        escapeHtml(label) + "</span>";
      return;
    }

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
  // whichever is mounted, or it sits on top of the bubble. Only matters
  // for the panel widget -- the frameless one hides the bubble the moment
  // it opens, so it has nothing to clear and sits at the same small
  // margin the bubble itself uses.
  function panelOffset() {
    if (frameless) return 20;
    return avatarUrl ? 124 : 88;
  }

  var frame = null;
  var panelWrap = null;
  var open = false;
  var expanded = false;
  // Set from the config fetch. A frameless widget is a different shape: no
  // card, no background, and wide enough to hold the avatar next to what
  // she is saying.
  var frameless = false;
  // The panel is a portrait card: a head-and-shoulders avatar plus one
  // action. Expanded is the same card with room to actually see the face.
  var PANEL_W = 340;
  var PANEL_H = 560;
  var PANEL_W_BIG = 420;
  var PANEL_H_BIG = 680;
  var FRAMELESS_W = 760;
  var FRAMELESS_H = 620;

  function ensureFrame() {
    if (frame) return;

    panelWrap = document.createElement("div");
    panelWrap.style.cssText =
      "position:fixed;" + edgeStyle +
      (isTop ? "top:" : "bottom:") + panelOffset() + "px;" +
      "width:" + (frameless ? FRAMELESS_W : PANEL_W) + "px;" +
      "height:" + (frameless ? FRAMELESS_H : PANEL_H) + "px;" +
      "max-width:calc(100vw - 40px);max-height:calc(100vh - " + (panelOffset() + 24) + "px);" +
      "z-index:2147483000;display:none;" +
      "transition:width 0.18s ease,height 0.18s ease;" +
      // Frameless paints nothing of its own: no card, no border, no
      // shadow, and no background for the host page to fight with. The
      // avatar's own drop-shadow is inside the frame.
      (frameless
        ? "background:transparent;border:0;box-shadow:none;overflow:visible;"
        : "border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(0,0,0,0.3);" +
          "border:1px solid rgba(0,0,0,0.08);background:#ffffff;");

    frame = document.createElement("iframe");
    frame.src = studioOrigin + "/embed/" + encodeURIComponent(publicKey);
    // Mic capture inside a cross-origin iframe needs an explicit
    // Permissions Policy delegation -- this is that grant. It only works
    // if the host page itself is HTTPS and its own Permissions-Policy (if
    // any) does not already block "microphone" from being delegated
    // further; that is a host-page configuration issue this script cannot
    // fix, only document (see the install instructions).
    frame.setAttribute("allow", "microphone");
    frame.style.cssText = "width:100%;height:100%;border:0;display:block;" +
      (frameless ? "background:transparent;" : "");
    // Chrome paints an opaque canvas behind an iframe unless the embedded
    // document is itself transparent; this is the other half of that.
    frame.setAttribute("allowtransparency", "true");
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
        if (!config) return;
        if (config.transparent) {
          frameless = true;
          if (panelWrap) {
            // Already built (the visitor clicked before this landed) --
            // rebuild the shape rather than leaving a white card.
            panelWrap.style.background = "transparent";
            panelWrap.style.border = "0";
            panelWrap.style.boxShadow = "none";
            panelWrap.style.borderRadius = "0";
            panelWrap.style.overflow = "visible";
            panelWrap.style.width = FRAMELESS_W + "px";
            panelWrap.style.height = FRAMELESS_H + "px";
            panelWrap.style[isTop ? "top" : "bottom"] = panelOffset() + "px";
            if (frame) frame.style.background = "transparent";
          }
        }
        if (!config.preview_image_url) return;

        if (config.transparent) {
          // Keying needs real pixels, not just something to point an <img>
          // at, so the still is loaded here first and run through the same
          // canvas pass the open panel's WebGL shader does at 25fps --
          // once, since this is one image, not a video.
          var srcImg = new Image();
          srcImg.crossOrigin = "anonymous"; // untainted canvas needs this
          srcImg.onload = function () {
            keyGreenScreenStill(srcImg, function (keyedUrl) {
              // A still that turned out not to be green-screened at all
              // (ticked transparent by mistake) keys to a no-op -- falling
              // back to the raw still here at least keeps a real photo on
              // screen rather than nothing.
              transparentAvatarUrl = keyedUrl || config.preview_image_url;
              renderBubble();
              if (panelWrap) {
                panelWrap.style[isTop ? "top" : "bottom"] = panelOffset() + "px";
              }
            });
          };
          srcImg.onerror = function () { /* icon stays */ };
          srcImg.src = config.preview_image_url;
          return;
        }

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
