const form = document.querySelector("#connect-form");
const passwordField = document.querySelector("#password");
const connectButton = document.querySelector("#connect");
const disconnectButton = document.querySelector("#disconnect");
const video = document.querySelector("#desktop");
const status = document.querySelector("#status");
const route = document.querySelector("#route");
const empty = document.querySelector("#empty");
const help = document.querySelector("#help");
const workspace = document.querySelector("#workspace");
const fullscreenButton = document.querySelector("#fullscreen");
const releaseButton = document.querySelector("#release");
const monitorSelect = document.querySelector("#monitor");
const relativeButton = document.querySelector("#relative");
const shortcutSelect = document.querySelector("#shortcut");
const shortcutButton = document.querySelector("#send-shortcut");
const clipboardToggle = document.querySelector("#clipboard-toggle");
const clipboardPanel = document.querySelector("#clipboard-panel");
const clipboardText = document.querySelector("#clipboard-text");
const clipboardSend = document.querySelector("#clipboard-send");
const clipboardGet = document.querySelector("#clipboard-get");
const controlStatus = document.querySelector("#control-status");
const channelLabel = "remmie-control-v1";
let active = null;

function show(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
}

function connecting(session, message, timeoutMessage) {
  if (active !== session) return;
  clearTimeout(session.connectTimer);
  session.timeoutMessage = timeoutMessage;
  session.connectTimer = setTimeout(
    () => finish(session, session.timeoutMessage, "error", true), 45000);
  show(message, "connecting");
}

function desktopControls(session) {
  const connected = session?.authorized && video.readyState >= 2 &&
    session.peer.connectionState === "connected";
  const features = session?.features || {};
  fullscreenButton.disabled = !connected || !workspace.requestFullscreen;
  releaseButton.disabled = !connected;
  relativeButton.disabled = !connected || !features.relativeMouse || !video.requestPointerLock;
  shortcutSelect.disabled = shortcutButton.disabled = !connected || !features.shortcuts;
  clipboardToggle.disabled = !connected || !features.clipboard;
  clipboardSend.disabled = clipboardGet.disabled = !connected || !features.clipboard || !!session.pendingControl;
  monitorSelect.disabled = !connected || !session.displays?.length || !!session.pendingControl;
}

function stopCapture(session) {
  releaseInput(session);
  globalThis.navigator?.keyboard?.unlock();
  if (document.pointerLockElement === video) document.exitPointerLock();
}

async function captureKeyboard() {
  if (document.fullscreenElement !== workspace || !navigator.keyboard?.lock) return;
  try {
    await navigator.keyboard.lock();
    controlStatus.textContent = "Keyboard capture active. Ctrl+Alt+Esc releases controls.";
  } catch {
    controlStatus.textContent = "Fullscreen active. This browser keeps some shortcuts; use the shortcut menu.";
  }
}

function requestControl(session, message) {
  if (session.pendingControl) return;
  session.pendingControl = message.type;
  session.monitorChanging = message.type === "monitor-select";
  session.controlTimer = setTimeout(() => {
    if (active !== session) return;
    session.pendingControl = null;
    session.monitorChanging = false;
    desktopControls(session);
    controlStatus.textContent = "The desktop operation timed out. Try again.";
  }, 15000);
  send(session, message);
  desktopControls(session);
}

function completeControl(session) {
  clearTimeout(session.controlTimer);
  session.pendingControl = null;
  session.monitorChanging = false;
  desktopControls(session);
}

function signalingBase() {
  const configured = new URL(location.href).searchParams.get("signal");
  const value = configured || (location.origin === "https://nikuhkid.github.io"
    ? "https://nikuhkid.ddns.net/api/" : null);
  if (!value) {
    const loopback = ["127.0.0.1", "localhost"].includes(location.hostname);
    const lan = location.protocol === "https:" && /^\d+(?:\.\d+){3}$/.test(location.hostname);
    if (!loopback && !lan && location.hostname !== "nikuhkid.ddns.net") {
      throw new Error("This viewer link needs a Remmie signaling address.");
    }
    return new URL("./api/", location.href);
  }
  const url = new URL(value);
  const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !loopback) || url.username || url.password ||
    url.search || url.hash || !/^\/api(?:\/[a-f0-9]{32})?\/?$/.test(url.pathname)
  ) {
    throw new Error("The Remmie signaling address is invalid.");
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

async function requestJSON(base, path, options) {
  const response = await fetch(new URL(path, base), {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    ...options,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new Error(payload?.error || `Signaling returned HTTP ${response.status}.`);
  }
  return payload;
}

function send(session, message) {
  if (session?.channel?.readyState !== "open") return false;
  session.channel.send(JSON.stringify(message));
  return true;
}

function releaseInput(session) {
  if (!session) return;
  cancelAnimationFrame(session.motionFrame);
  session.motionFrame = 0;
  session.motion = null;
  session.relativeMotion = null;
  session.buttons.clear();
  if (session.authorized) send(session, { type: "release" });
}

function finish(session, message, state = "idle", tellHost = false) {
  if (active !== session) return;
  active = null;
  stopCapture(session);
  const sent = tellHost && send(session, { type: "disconnect" });
  session.abort.abort();
  clearTimeout(session.connectTimer);
  clearInterval(session.pingTimer);
  clearInterval(session.statsTimer);
  clearTimeout(session.controlTimer);
  session.password = "";
  if (sent) {
    // Give the reliable control message time to leave before closing transport.
    setTimeout(() => session.peer?.close(), 350);
  } else {
    session.peer?.close();
  }
  video.srcObject = null;
  empty.hidden = false;
  route.textContent = "";
  help.textContent = "";
  controlStatus.textContent = "";
  clipboardPanel.hidden = true;
  clipboardToggle.setAttribute("aria-expanded", "false");
  monitorSelect.replaceChildren(new Option("Host display", ""));
  desktopControls(null);
  if (document.fullscreenElement === workspace) document.exitFullscreen().catch(() => {});
  connectButton.disabled = false;
  disconnectButton.disabled = true;
  show(message, state);
}

function waitForIce(peer, signal) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    function dispose() {
      peer.removeEventListener("icegatheringstatechange", check);
      signal.removeEventListener("abort", cancel);
    }
    function check() {
      if (peer.iceGatheringState === "complete") {
        dispose();
        resolve();
      }
    }
    function cancel() {
      dispose();
      reject(signal.reason);
    }
    peer.addEventListener("icegatheringstatechange", check);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    else check();
  });
}

async function showRoute(session) {
  const report = await session.peer.getStats().catch(() => null);
  if (!report || active !== session) return;
  let pair;
  for (const stat of report.values()) {
    if (stat.type === "transport" && stat.selectedCandidatePairId) {
      pair = report.get(stat.selectedCandidatePairId);
      break;
    }
  }
  if (!pair) {
    pair = [...report.values()].find(stat =>
      stat.type === "candidate-pair" && stat.nominated && stat.state === "succeeded");
  }
  if (!pair) return;
  const candidateTypes = [pair.localCandidateId, pair.remoteCandidateId]
    .map(id => report.get(id)?.candidateType);
  if (candidateTypes.every(Boolean)) {
    route.textContent = candidateTypes.includes("relay") ? "Relayed connection" : "Direct connection";
  }
}

async function connect(password) {
  if (active) return;
  const session = {
    password,
    abort: new AbortController(),
    authorized: false,
    buttons: new Set(),
    motionFrame: 0,
  };
  active = session;
  connectButton.disabled = true;
  disconnectButton.disabled = false;
  connecting(session, "Contacting signaling…", "Timed out reaching the signaling endpoint.");
  try {
    const base = signalingBase();
    const signal = session.abort.signal;
    const config = await requestJSON(base, "ice", { signal });
    if (active !== session) return;
    connecting(session, "Gathering WebRTC network addresses…",
      "The browser timed out gathering WebRTC network addresses.");
    const peer = new RTCPeerConnection({ iceServers: config.iceServers });
    session.peer = peer;
    peer.addTransceiver("video", { direction: "recvonly" });
    peer.addEventListener("track", event => {
      if (active === session && event.track.kind === "video") {
        video.srcObject = event.streams[0] || new MediaStream([event.track]);
        video.play().catch(() => {});
      }
    });
    peer.addEventListener("connectionstatechange", () => {
      if (active !== session) return;
      if (peer.connectionState === "failed") {
        const message = peer.iceConnectionState === "failed"
          ? "WebRTC could not find a working network path to Wolfie."
          : "The WebRTC transport failed.";
        finish(session, message, "error");
      } else if (peer.connectionState === "disconnected") {
        releaseInput(session);
        show("The connection was interrupted.", "connecting");
      } else if (peer.connectionState === "connected" && session.authorized && video.videoWidth) {
        showDesktop(session);
      }
    });
    const channel = peer.createDataChannel(channelLabel);
    session.channel = channel;
    peer.addEventListener("iceconnectionstatechange", () => {
      if (active === session && channel.readyState === "connecting" &&
          ["connected", "completed"].includes(peer.iceConnectionState)) {
        connecting(session, "Opening the control channel…",
          "WebRTC found a network path, but the control channel timed out.");
      }
    });
    channel.addEventListener("open", () => {
      if (active !== session) return;
      connecting(session, "Checking password…", "Wolfie did not reply to the password check.");
      send(session, { type: "auth", password: session.password });
      session.password = "";
    });
    channel.addEventListener("close", () => finish(session, "Disconnected."));
    channel.addEventListener("message", event => {
      if (active !== session) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type === "ready" && !session.authorized) {
        session.authorized = true;
        session.canInput = message.input === true;
        session.features = message.features || {};
        if (session.features.monitors) session.pendingControl = "monitors-get";
        help.textContent = session.canInput
          ? "Click the desktop to send input. Ctrl+Alt+Esc releases keyboard and mouse capture."
          : "Local preview. Open the remote viewer on another device for control.";
        connecting(session, "Waiting for Wolfie’s desktop…",
          "Password accepted, but desktop video did not start.");
        session.pingTimer = setInterval(() => send(session, { type: "ping" }), 10000);
        session.statsTimer = setInterval(() => showRoute(session), 2000);
        showRoute(session);
        if (video.videoWidth && video.readyState >= 2) showDesktop(session);
        if (!message.features && session.canInput) {
          controlStatus.textContent = "Restart the host to enable the new desktop controls.";
        }
      } else if (message?.type === "monitors" && session.authorized) {
        session.displays = Array.isArray(message.displays) ? message.displays.filter(display =>
          Number.isInteger(display.id) && display.id > 0 && display.width > 0 && display.height > 0
        ).slice(0, 64) : [];
        monitorSelect.replaceChildren(...session.displays.map(display =>
          new Option(`Display ${display.id} · ${display.width}×${display.height}`, display.id)));
        monitorSelect.value = String(message.selected);
        session.selectedMonitor = monitorSelect.value;
        completeControl(session);
      } else if (message?.type === "clipboard-text" && session.authorized) {
        clipboardText.value = message.text;
        completeControl(session);
        controlStatus.textContent = "Text received from Wolfie. Choose Copy locally to use it here.";
      } else if (message?.type === "clipboard-set" && session.authorized) {
        completeControl(session);
        controlStatus.textContent = "Wolfie's clipboard updated.";
      } else if (message?.type === "control-error" && session.authorized) {
        completeControl(session);
        monitorSelect.value = session.selectedMonitor || "";
        controlStatus.textContent = message.message;
      } else if (message?.type === "denied" || message?.type === "error") {
        finish(session, message.message, "error");
      } else if (message?.type === "input-error") {
        show(message.message, "error");
      }
    });
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIce(peer, signal);
    connecting(session, "Waiting for Wolfie’s WebRTC answer…", "Wolfie’s WebRTC answer timed out.");
    const answer = await requestJSON(base, "offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(peer.localDescription),
      signal,
    });
    if (active === session) {
      connecting(session, "Checking WebRTC network paths…",
        "Wolfie answered, but WebRTC timed out checking network paths.");
      await peer.setRemoteDescription(answer);
    }
  } catch (error) {
    finish(session, error.message || "Connection failed.", "error");
  }
}

function showDesktop(session) {
  if (active !== session || !session.authorized) return;
  clearTimeout(session.connectTimer);
  empty.hidden = true;
  desktopControls(session);
  show(session.canInput ? "Connected to Wolfie." : "Previewing Wolfie’s desktop.", "connected");
}

video.addEventListener("playing", () => {
  if (active) showDesktop(active);
});

form.addEventListener("submit", event => {
  event.preventDefault();
  const value = passwordField.value;
  if (Array.from(value).length < 8 || new TextEncoder().encode(value).length > 256) {
    show("Use the password set on Wolfie. It must be at least eight characters.", "error");
    return;
  }
  passwordField.value = "";
  connect(value);
});
disconnectButton.addEventListener("click", () => {
  if (active) finish(active, "Disconnected.", "idle", true);
});
window.addEventListener("pagehide", () => {
  if (active) finish(active, "Disconnected.", "idle", true);
});

function inputSession() {
  return active?.canInput && !active.monitorChanging && active.peer.connectionState === "connected" && video.videoWidth
    ? active : null;
}

function point(event, clamp = false) {
  const box = video.getBoundingClientRect();
  const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  const x = (event.clientX - box.left - (box.width - width) / 2) / width;
  const y = (event.clientY - box.top - (box.height - height) / 2) / height;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

video.addEventListener("pointermove", event => {
  const session = inputSession();
  if (!session || document.activeElement !== video) return;
  if (document.pointerLockElement === video) {
    session.relativeMotion ||= { dx: 0, dy: 0 };
    session.relativeMotion.dx += event.movementX;
    session.relativeMotion.dy += event.movementY;
  } else {
    const position = point(event, session.buttons.size > 0);
    if (!position) return;
    session.motion = position;
  }
  if (session.motionFrame) return;
  session.motionFrame = requestAnimationFrame(() => {
    session.motionFrame = 0;
    if (inputSession() === session && session.channel.bufferedAmount < 16384) {
      if (session.relativeMotion && document.pointerLockElement === video) {
        const bounded = value => Math.max(-32767, Math.min(32767, Math.round(value)));
        send(session, { type: "relative-move",
          dx: bounded(session.relativeMotion.dx), dy: bounded(session.relativeMotion.dy) });
      } else if (session.motion) {
        send(session, { type: "move", ...session.motion });
      }
    }
    session.motion = null;
    session.relativeMotion = null;
  });
});

video.addEventListener("pointerdown", event => {
  const session = inputSession();
  if (!session || ![0, 1, 2].includes(event.button)) return;
  const relative = document.pointerLockElement === video;
  const position = relative ? {} : point(event);
  if (!position) return;
  event.preventDefault();
  video.focus({ preventScroll: true });
  captureKeyboard();
  if (!relative) video.setPointerCapture(event.pointerId);
  session.buttons.add(event.button);
  send(session, { type: "button", button: event.button, pressed: true, relative, ...position });
});

video.addEventListener("pointerup", event => {
  const session = inputSession();
  if (!session?.buttons.delete(event.button)) return;
  const relative = document.pointerLockElement === video;
  send(session, { type: "button", button: event.button, pressed: false, relative,
    ...(relative ? {} : point(event, true)) });
});

video.addEventListener("pointercancel", () => releaseInput(active));
video.addEventListener("lostpointercapture", () => {
  if (active?.buttons.size) releaseInput(active);
});
video.addEventListener("contextmenu", event => {
  if (inputSession()) event.preventDefault();
});
video.addEventListener("wheel", event => {
  const session = inputSession();
  if (!session || document.activeElement !== video) return;
  const relative = document.pointerLockElement === video;
  const position = relative ? {} : point(event);
  if (!position) return;
  event.preventDefault();
  const multiplier = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 120 : 1;
  const wheelUnits = delta => Math.max(-1200, Math.min(1200, Math.round(delta * multiplier)));
  send(session, { type: "wheel", dx: wheelUnits(event.deltaX), dy: wheelUnits(-event.deltaY), relative, ...position });
}, { passive: false });

video.addEventListener("keydown", event => {
  const session = inputSession();
  if (!session || event.isComposing || !event.code) return;
  event.preventDefault();
  if (event.code === "Escape" && event.ctrlKey && event.altKey) {
    stopCapture(session);
    releaseButton.focus();
    return;
  }
  send(session, { type: "key", code: event.code, pressed: true });
});

video.addEventListener("keyup", event => {
  const session = inputSession();
  if (!session || event.isComposing || !event.code) return;
  event.preventDefault();
  send(session, { type: "key", code: event.code, pressed: false });
});

video.addEventListener("blur", () => stopCapture(active));
window.addEventListener("blur", () => stopCapture(active));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCapture(active);
});

fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement === workspace) {
      await document.exitFullscreen();
    } else {
      await workspace.requestFullscreen();
      video.focus({ preventScroll: true });
      await captureKeyboard();
    }
  } catch (error) {
    controlStatus.textContent = `Fullscreen unavailable: ${error.message}`;
  }
});
document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement === workspace ? "Exit fullscreen" : "Fullscreen";
  if (document.fullscreenElement !== workspace) stopCapture(active);
});
releaseButton.addEventListener("click", () => {
  stopCapture(active);
  controlStatus.textContent = "Controls released. Click the desktop to resume.";
});
relativeButton.addEventListener("click", async () => {
  if (!inputSession()) return;
  if (document.pointerLockElement === video) {
    document.exitPointerLock();
    return;
  }
  try {
    await video.requestPointerLock({ unadjustedMovement: true });
  } catch (error) {
    if (error.name === "NotSupportedError") {
      try { await video.requestPointerLock(); } catch (failure) {
        controlStatus.textContent = `Mouse capture unavailable: ${failure.message}`;
      }
    } else {
      controlStatus.textContent = `Mouse capture unavailable: ${error.message}`;
    }
  }
});
document.addEventListener("pointerlockchange", () => {
  releaseInput(active);
  const locked = document.pointerLockElement === video;
  relativeButton.setAttribute("aria-pressed", String(locked));
  relativeButton.textContent = locked ? "Release mouse" : "Relative mouse";
  if (locked) video.focus({ preventScroll: true });
  controlStatus.textContent = locked
    ? "Relative mouse active. Ctrl+Alt+Esc releases controls."
    : "Mouse capture released.";
});
document.addEventListener("pointerlockerror", () => {
  controlStatus.textContent = "Mouse capture failed. Activate this browser window and try Relative mouse again.";
});
shortcutButton.addEventListener("click", () => {
  const session = inputSession();
  if (!session) return;
  releaseInput(session);
  send(session, { type: "shortcut", name: shortcutSelect.value });
  video.focus({ preventScroll: true });
});
monitorSelect.addEventListener("change", () => {
  const session = active;
  if (!session?.features?.monitors) return;
  stopCapture(session);
  requestControl(session, { type: "monitor-select", id: Number(monitorSelect.value) });
});
clipboardToggle.addEventListener("click", () => {
  clipboardPanel.hidden = !clipboardPanel.hidden;
  clipboardToggle.setAttribute("aria-expanded", String(!clipboardPanel.hidden));
  if (!clipboardPanel.hidden) clipboardText.focus();
});
document.querySelector("#clipboard-read").addEventListener("click", async () => {
  try {
    clipboardText.value = await navigator.clipboard.readText();
    controlStatus.textContent = "Local text loaded. Choose Send to Wolfie to transfer it.";
  } catch {
    clipboardText.focus();
    controlStatus.textContent = "Paste into the text box with Ctrl+V, then choose Send to Wolfie.";
  }
});
clipboardSend.addEventListener("click", () => {
  const session = active;
  if (!session?.features?.clipboard) return;
  if (new TextEncoder().encode(clipboardText.value).length > 8192) {
    controlStatus.textContent = "Clipboard text exceeds the 8 KiB limit.";
    return;
  }
  requestControl(session, { type: "clipboard-set", text: clipboardText.value });
});
clipboardGet.addEventListener("click", () => {
  if (active?.features?.clipboard) requestControl(active, { type: "clipboard-get" });
});
document.querySelector("#clipboard-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(clipboardText.value);
    controlStatus.textContent = "Text copied to the local clipboard.";
  } catch {
    clipboardText.focus();
    clipboardText.select();
    controlStatus.textContent = "Press Ctrl+C to copy the selected text.";
  }
});
