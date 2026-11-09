const form = document.querySelector("#connect-form");
const passwordField = document.querySelector("#password");
const connectButton = document.querySelector("#connect");
const disconnectButton = document.querySelector("#disconnect");
const video = document.querySelector("#desktop");
const status = document.querySelector("#status");
const route = document.querySelector("#route");
const empty = document.querySelector("#empty");
const help = document.querySelector("#help");
const channelLabel = "remmie-control-v1";
let active = null;

function show(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
}

function connecting(session, message, timeoutMessage) {
  session.timeoutMessage = timeoutMessage;
  show(message, "connecting");
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
  session.buttons.clear();
  if (session.authorized) send(session, { type: "release" });
}

function finish(session, message, state = "idle", tellHost = false) {
  if (active !== session) return;
  active = null;
  releaseInput(session);
  const sent = tellHost && send(session, { type: "disconnect" });
  session.abort.abort();
  clearTimeout(session.connectTimer);
  clearInterval(session.pingTimer);
  clearInterval(session.statsTimer);
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
  session.connectTimer = setTimeout(
    () => finish(session, session.timeoutMessage, "error", true), 45000);
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
        help.textContent = session.canInput
          ? "Click the desktop to send input. Press Ctrl+Alt+Esc to release keyboard focus."
          : "Local preview. Open the remote viewer on another device for control.";
        connecting(session, "Waiting for Wolfie’s desktop…",
          "Password accepted, but desktop video did not start.");
        session.pingTimer = setInterval(() => send(session, { type: "ping" }), 10000);
        session.statsTimer = setInterval(() => showRoute(session), 2000);
        showRoute(session);
        if (video.videoWidth && video.readyState >= 2) showDesktop(session);
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
  return active?.canInput && active.peer.connectionState === "connected" && video.videoWidth
    ? active : null;
}

function point(event) {
  const box = video.getBoundingClientRect();
  const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  return {
    x: Math.min(1, Math.max(0, (event.clientX - box.left - (box.width - width) / 2) / width)),
    y: Math.min(1, Math.max(0, (event.clientY - box.top - (box.height - height) / 2) / height)),
  };
}

video.addEventListener("pointermove", event => {
  const session = inputSession();
  if (!session || document.activeElement !== video) return;
  session.motion = point(event);
  if (session.motionFrame) return;
  session.motionFrame = requestAnimationFrame(() => {
    session.motionFrame = 0;
    if (inputSession() === session && session.motion && session.channel.bufferedAmount < 16384) {
      send(session, { type: "move", ...session.motion });
    }
    session.motion = null;
  });
});

video.addEventListener("pointerdown", event => {
  const session = inputSession();
  if (!session || ![0, 1, 2].includes(event.button)) return;
  event.preventDefault();
  video.focus({ preventScroll: true });
  video.setPointerCapture(event.pointerId);
  session.buttons.add(event.button);
  send(session, { type: "button", button: event.button, pressed: true, ...point(event) });
});

video.addEventListener("pointerup", event => {
  const session = inputSession();
  if (!session?.buttons.delete(event.button)) return;
  send(session, { type: "button", button: event.button, pressed: false, ...point(event) });
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
  event.preventDefault();
  const multiplier = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 120 : 1;
  const wheelUnits = delta => Math.max(-1200, Math.min(1200, Math.round(delta * multiplier)));
  send(session, { type: "wheel", dx: wheelUnits(event.deltaX), dy: wheelUnits(-event.deltaY), ...point(event) });
}, { passive: false });

video.addEventListener("keydown", event => {
  const session = inputSession();
  if (!session || event.isComposing || !event.code) return;
  event.preventDefault();
  if (event.code === "Escape" && event.ctrlKey && event.altKey) {
    disconnectButton.focus();
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

video.addEventListener("blur", () => releaseInput(active));
window.addEventListener("blur", () => releaseInput(active));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseInput(active);
});
