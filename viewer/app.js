const form = document.querySelector("#connect-form");
const serverField = document.querySelector("#server");
const serverLabel = document.querySelector("#server-label");
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
const performanceStart = document.querySelector("#performance-start");
const performanceCopy = document.querySelector("#performance-copy");
const performanceSave = document.querySelector("#performance-save");
const performanceLive = document.querySelector("#performance-live");
const performanceSummary = document.querySelector("#performance-summary");
const sessionMenu = document.querySelector("#session-menu");
const menuToggle = document.querySelector("#session-toggle");
const codecSelect = document.querySelector("#video-codec");
const audio = document.querySelector("#desktop-audio");
const audioToggle = document.querySelector("#audio-toggle");
const audioVolume = document.querySelector("#audio-volume");
const audioStatus = document.querySelector("#audio-status");
const resolutionSelect = document.querySelector("#video-resolution");
const resolutionSizes = ["native", "3840x2160", "3840x1600", "3440x1440", "2560x1600", "2560x1440", "2560x1080", "1920x1200", "1920x1080", "1680x1050", "1600x1200", "1600x900", "1366x768", "1280x1024", "1280x800", "1280x720", "1024x768", "960x540", "640x360"];
let selectedResolution = null;
let audioWanted = true;
const fpsSelect = document.querySelector("#video-fps");
const clipboardStatus = document.querySelector("#clipboard-status");
const fileStatus = document.querySelector("#file-status");
let clipboardAllowed = false;
let selectedCodec = "auto";
let selectedFPS = null;
let active = null;
let desired = null;
let measurement = null;
let lastMeasurement = null;

function forgetConnection() {
  if (!desired) return;
  clearTimeout(desired.timer);
  desired.password = "";
  desired = null;
}

function reconnect(intent, reason) {
  if (desired !== intent) return;
  connectButton.disabled = true;
  disconnectButton.disabled = false;
  serverField.disabled = passwordField.disabled = true;
  if (navigator.onLine === false) {
    show("Network offline. Remmie will reconnect when it returns.", "connecting");
    return;
  }
  const delay = Math.min(15000, 1000 * 2 ** Math.min(intent.attempt++, 4));
  show(`${reason} Reconnecting in ${delay / 1000}s…`, "connecting");
  intent.timer = setTimeout(() => {
    if (desired === intent && !active) connect(intent.password, intent);
  }, delay);
}

function show(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
}

function connecting(session, message, timeoutMessage) {
  if (active !== session) return;
  clearTimeout(session.connectTimer);
  session.timeoutMessage = timeoutMessage;
  session.connectTimer = setTimeout(
    () => finish(session, session.timeoutMessage, "error", true, true), 45000);
  show(message, "connecting");
}

function desktopControls(session) {
  const connected = session?.authorized && video.readyState >= 2 &&
    session.peer.connectionState === "connected";
  const features = session?.features || {};
  const filesBusy = !!(session?.fileBusy || session?.fileCancelling);
  fullscreenButton.disabled = !connected || !workspace.requestFullscreen;
  releaseButton.disabled = !connected;
  relativeButton.disabled = !connected || !features.relativeMouse || !video.requestPointerLock;
  shortcutSelect.disabled = shortcutButton.disabled = !connected || !features.shortcuts;
  clipboardToggle.disabled = !connected || !features.clipboard;
  clipboardSend.disabled = clipboardGet.disabled = !connected || !features.clipboard || !!session.pendingControl;
  monitorSelect.disabled = !connected || !session.displays?.length || !!session.pendingControl;
  performanceStart.disabled = !connected || !!measurement;
  codecSelect.disabled = !connected || !session?.codecs?.length;
  resolutionSelect.disabled = !connected || !features.resolutions || !!session.pendingControl;
  audioToggle.disabled = audioVolume.disabled = !session?.authorized || !features.audio;
  fpsSelect.disabled = !connected || !features.videoSettings || !!session.pendingControl;
  document.querySelector("#clipboard-enable").disabled = !connected || !features.clipboardSync;
  for (const id of ["file-upload", "file-pick"]) {
    document.querySelector(`#${id}`).disabled = !connected || !features.files || filesBusy;
  }
  document.querySelector("#file-download").disabled = !connected || !features.files || !session?.download || filesBusy;
  document.querySelector("#file-cancel").disabled = !session?.fileBusy || !!session?.fileCancelling;
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
  if (session.restoreFPS) {
    const fps = session.restoreFPS;
    session.restoreFPS = null;
    requestControl(session, {type: "video-settings", fps});
  } else if (session.restoreResolution) {
    const resolution = session.restoreResolution;
    session.restoreResolution = null;
    requestControl(session, {type: "video-settings", resolution});
  }
}

function signalingBase(value) {
  const address = typeof value === "string" ? value.trim() : "";
  if (!address) throw new Error("Enter your Remmie server address.");
  if (address.length > 2048 || /[\s\\]/.test(address)) throw new Error("Enter a valid server hostname or HTTPS URL.");
  let url;
  try { url = new URL(address.includes("://") ? address : `https://${address}`); }
  catch { throw new Error("Enter a valid server hostname or HTTPS URL."); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Use HTTPS for your server, without credentials, a query or a fragment. HTTP is available for localhost testing.");
  }
  if (url.pathname === "/") url.pathname = "/api/";
  else if (!/^\/api(?:\/[a-f0-9]{32})?\/?$/.test(url.pathname))
    throw new Error("Use the server address or its Remmie /api/ endpoint.");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

// Existing explicit signaling links prefill the visible field; they never auto-connect.
const linkedServer = new URL(location.href).searchParams.get("signal");
if (linkedServer) serverField.value = linkedServer;

function videoCodecSupported(codec, name) {
  if (codec.mimeType.toLowerCase() !== `video/${name}`.toLowerCase()) return false;
  const params = new URLSearchParams((codec.sdpFmtpLine || "").trim().replace(/\s*;\s*/g, "&"));
  if (name === "VP9") return Number(params.get("profile-id") || 0) === 0;
  if (name === "AV1") return Number(params.get("profile") || 0) === 0 && Number(params.get("level-idx") || 5) >= 5;
  return true;
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
    const error = new Error(payload?.error || `Signaling returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
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

function finish(session, message, state = "idle", tellHost = false, recover = false) {
  if (active !== session) return;
  if (measurement?.session === session) endMeasurement("Connection ended; partial measurement.");
  active = null;
  document.body.classList.remove("connected");
  stopCapture(session);
  const sent = tellHost && send(session, { type: "disconnect" });
  session.abort.abort();
  clearTimeout(session.connectTimer);
  clearInterval(session.pingTimer);
  clearInterval(session.statsTimer);
  clearTimeout(session.controlTimer);
  clearTimeout(session.disconnectTimer);
  clearInterval(session.clipboardTimer);
  session.fileAbort?.abort();
  session.fileToken = "";
  session.password = "";
  if (sent) {
    // Give the reliable control message time to leave before closing transport.
    setTimeout(() => session.peer?.close(), 350);
  } else {
    session.peer?.close();
  }
  video.srcObject = null;
  audio.pause();
  audio.srcObject = null;
  audioStatus.textContent = "Connect to hear remote audio.";
  empty.hidden = false;
  route.textContent = "";
  serverLabel.textContent = "Remote desktop";
  performanceLive.textContent = "Connect to read stream statistics.";
  help.textContent = "";
  controlStatus.textContent = "";
  clipboardPanel.hidden = true;
  clipboardToggle.setAttribute("aria-expanded", "false");
  monitorSelect.replaceChildren(new Option("Host display", ""));
  desktopControls(null);
  if (document.fullscreenElement === workspace) document.exitFullscreen().catch(() => {});
  connectButton.disabled = false;
  disconnectButton.disabled = true;
  serverField.disabled = passwordField.disabled = false;
  if (recover && desired === session.intent && session.intent.connected) {
    reconnect(session.intent, message);
  } else {
    forgetConnection();
    show(message, state);
  }
}

function heartbeat(session) {
  if (active !== session) return;
  if (session.features?.heartbeat && Date.now() - session.lastPong > 15000) {
    finish(session, "The remote host stopped responding.", "error", true, true);
    return;
  }
  send(session, { type: "ping" });
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
  updatePerformance(session, report);
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

function performanceInterval(report, previous) {
  const inbound = [...report.values()].find(stat => stat.type === "inbound-rtp" &&
    (stat.kind === "video" || stat.mediaType === "video"));
  if (!inbound) return { baseline: null, sample: null };
  const fields = ["timestamp", "bytesReceived", "framesDecoded", "framesDropped", "packetsReceived",
    "packetsLost", "totalDecodeTime", "jitterBufferDelay", "jitterBufferEmittedCount", "freezeCount"];
  const baseline = { id: inbound.id };
  for (const key of fields) baseline[key] = Number.isFinite(inbound[key]) ? inbound[key] : null;
  const seconds = previous?.id === baseline.id ? (baseline.timestamp - previous.timestamp) / 1000 : 0;
  if (previous?.id === baseline.id && !(seconds > 0)) return { baseline: previous, sample: null };
  if (!(seconds > 0) || baseline.framesDecoded < previous.framesDecoded ||
      baseline.bytesReceived < previous.bytesReceived) return { baseline, sample: null };
  const delta = key => baseline[key] !== null && previous[key] !== null
    ? Math.max(0, baseline[key] - previous[key]) : null;
  const decoded = delta("framesDecoded"), received = delta("packetsReceived"), lost = delta("packetsLost");
  const codec = report.get(inbound.codecId);
  const transport = report.get(inbound.transportId);
  const pair = report.get(transport?.selectedCandidatePairId) || [...report.values()].find(stat =>
    stat.type === "candidate-pair" && stat.nominated && stat.state === "succeeded");
  const types = [report.get(pair?.localCandidateId)?.candidateType, report.get(pair?.remoteCandidateId)?.candidateType];
  const sample = {
    seconds, decodedFrames: decoded, payloadBytes: delta("bytesReceived"),
    droppedFrames: delta("framesDropped"), receivedPackets: received, lostPackets: lost,
    decodeSeconds: delta("totalDecodeTime"), bufferSeconds: delta("jitterBufferDelay"),
    bufferFrames: delta("jitterBufferEmittedCount"), freezes: delta("freezeCount"),
    codec: codec?.mimeType || null, width: inbound.frameWidth || null, height: inbound.frameHeight || null,
    route: types.every(Boolean) ? (types.includes("relay") ? "relayed" : "direct") : null,
    networkRTTMs: Number.isFinite(pair?.currentRoundTripTime) ? pair.currentRoundTripTime * 1000 : null,
    fps: decoded === null ? null : decoded / seconds,
    payloadMbps: delta("bytesReceived") === null ? null : delta("bytesReceived") * 8 / seconds / 1e6,
    packetLossPercent: received !== null && lost !== null && received + lost > 0 ? 100 * lost / (received + lost) : null,
    decodeMs: decoded > 0 && delta("totalDecodeTime") !== null ? delta("totalDecodeTime") * 1000 / decoded : null,
    jitterBufferMs: delta("jitterBufferEmittedCount") > 0 && delta("jitterBufferDelay") !== null
      ? delta("jitterBufferDelay") * 1000 / delta("jitterBufferEmittedCount") : null,
  };
  return { baseline, sample };
}

function summarizePerformance(samples) {
  const total = key => samples.some(sample => sample[key] === null) ? null :
    samples.reduce((sum, sample) => sum + sample[key], 0);
  const ratio = (numerator, denominator, scale = 1) => numerator !== null && denominator > 0
    ? scale * numerator / denominator : null;
  const rtt = samples.map(sample => sample.networkRTTMs).filter(Number.isFinite).sort((a, b) => a - b);
  const packets = total("receivedPackets"), lost = total("lostPackets"), seconds = total("seconds");
  return {
    intervals: samples.length, observedSeconds: seconds,
    fps: ratio(total("decodedFrames"), seconds),
    videoPayloadMbps: ratio(total("payloadBytes"), seconds, 8 / 1e6),
    networkRTTMedianMs: rtt.length ? rtt[Math.floor((rtt.length - 1) / 2)] : null,
    networkRTTP95Ms: rtt.length ? rtt[Math.ceil(rtt.length * .95) - 1] : null,
    packetLossPercent: packets !== null && lost !== null ? ratio(lost, packets + lost, 100) : null,
    decodeMs: ratio(total("decodeSeconds"), total("decodedFrames"), 1000),
    jitterBufferMs: ratio(total("bufferSeconds"), total("bufferFrames"), 1000),
    droppedFrames: total("droppedFrames"), freezes: total("freezes"),
    codec: samples.at(-1)?.codec || null,
    resolution: samples.at(-1)?.width && samples.at(-1)?.height
      ? `${samples.at(-1).width}×${samples.at(-1).height}` : null,
    route: samples.at(-1)?.route || null,
  };
}

function measurementText(result) {
  const value = (number, digits = 1) => Number.isFinite(number) ? number.toFixed(digits) : "unavailable";
  const s = result.summary;
  return ["Remmie performance measurement", result.reason,
    `Observed ${value(s.observedSeconds)}s; ${s.resolution || "unknown resolution"}; ${s.codec || "unknown codec"}; ${s.route || "unknown route"}`,
    `Decoded FPS ${value(s.fps)}; video payload ${value(s.videoPayloadMbps, 3)} Mbps`,
    `Network RTT median/p95 ${value(s.networkRTTMedianMs)}/${value(s.networkRTTP95Ms)} ms`,
    `Packet loss ${value(s.packetLossPercent, 2)}%; dropped frames ${s.droppedFrames ?? "unavailable"}; freezes ${s.freezes ?? "unavailable"}`,
    `Decode ${value(s.decodeMs, 2)} ms/frame; jitter buffer ${value(s.jitterBufferMs)} ms`,
    "RTT and receiver timings do not measure input-to-screen delay."].join("\n");
}

function updatePerformance(session, report) {
  const { baseline, sample } = performanceInterval(report, session.performancePrevious);
  session.performancePrevious = baseline;
  if (!sample) return;
  const number = value => Number.isFinite(value) ? value.toFixed(1) : "?";
  const bitrate = Number.isFinite(sample.payloadMbps) ? sample.payloadMbps.toFixed(3) : "?";
  performanceLive.textContent = `${number(sample.fps)} FPS · ${bitrate} Mbps video · ` +
    `${number(sample.networkRTTMs)} ms network RTT · ${sample.codec || "codec unknown"}`;
  if (measurement?.session === session) {
    measurement.samples.push(sample);
    const remaining = Math.max(0, 60 - (performance.now() - measurement.started) / 1000);
    performanceSummary.textContent = `Measuring… ${Math.ceil(remaining)}s remaining. Use the remote desktop normally, including some scrolling or window movement.`;
  }
}

function endMeasurement(reason) {
  if (!measurement) return;
  clearTimeout(measurement.timer);
  lastMeasurement = {
    version: 1, measuredUTC: measurement.startedUTC, reason,
    browser: navigator.userAgent, summary: summarizePerformance(measurement.samples),
    samples: measurement.samples,
    scope: "Receiver statistics only; video payload excludes transport overhead; no input-to-screen measurement",
  };
  measurement = null;
  performanceSummary.textContent = measurementText(lastMeasurement);
  performanceCopy.disabled = performanceSave.disabled = false;
  desktopControls(active);
}

performanceStart.addEventListener("click", () => {
  if (!active?.authorized || measurement) return;
  lastMeasurement = null;
  performanceCopy.disabled = performanceSave.disabled = true;
  active.performancePrevious = null;
  measurement = { session: active, started: performance.now(), startedUTC: new Date().toISOString(), samples: [] };
  measurement.timer = setTimeout(() => endMeasurement("60-second measurement complete."), 60000);
  performanceSummary.textContent = "Measuring… use the remote desktop normally, including some scrolling or window movement.";
  desktopControls(active);
  showRoute(active);
});
performanceCopy.addEventListener("click", async () => {
  if (!lastMeasurement) return;
  try { await navigator.clipboard.writeText(measurementText(lastMeasurement)); }
  catch { performanceSummary.focus(); }
});
performanceSave.addEventListener("click", () => {
  if (!lastMeasurement) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(lastMeasurement, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "remmie-performance.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

async function connect(password, intent = null) {
  if (active) return;
  if (!intent) {
    let base;
    try { base = signalingBase(serverField.value); }
    catch (error) { show(error.message, "error"); serverField.focus(); return; }
    forgetConnection();
    serverField.value = base.href;
    desired = intent = { password, server: base.href, connected: false, attempt: 0 };
  }
  if (desired !== intent) return;
  serverField.value = intent.server;
  const session = {
    password,
    intent,
    abort: new AbortController(),
    authorized: false,
    buttons: new Set(),
    motionFrame: 0,
  };
  active = session;
  connectButton.disabled = true;
  disconnectButton.disabled = false;
  serverField.disabled = passwordField.disabled = true;
  connecting(session, "Contacting signaling…", "Timed out reaching the signaling endpoint.");
  try {
    // Recovery always uses the destination chosen at Connect, even if the field changes.
    const base = new URL(intent.server);
    session.base = base;
    serverLabel.textContent = base.host;
    const signal = session.abort.signal;
    const config = await requestJSON(base, "ice", { signal });
    if (active !== session) return;
    connecting(session, "Gathering WebRTC network addresses…",
      "The browser timed out gathering WebRTC network addresses.");
    const peer = new RTCPeerConnection({ iceServers: config.iceServers });
    session.peer = peer;
    const transceiver = peer.addTransceiver("video", { direction: "recvonly" });
    if (config.audio === true) peer.addTransceiver("audio", {direction: "recvonly"});
    const browserCodecs = globalThis.RTCRtpReceiver?.getCapabilities("video")?.codecs || [];
    session.codecs = (config.videoCodecs || []).filter(name => browserCodecs.some(c => videoCodecSupported(c, name)));
    codecSelect.replaceChildren(new Option("Automatic", "auto"), ...session.codecs.map(name =>
      new Option(config.videoEncoders?.[name] ? `${name} · ${config.videoEncoders[name]}` : name, name)));
    if (!session.codecs.includes(selectedCodec)) selectedCodec = "auto";
    codecSelect.value = selectedCodec;
    document.querySelector("#codec-status").textContent = session.codecs.length
      ? "Available on both devices. Changing codec reconnects this session."
      : "This host needs the controls update before codec selection is available.";
    if (selectedCodec !== "auto") {
      transceiver.setCodecPreferences(browserCodecs.filter(c =>
        videoCodecSupported(c, selectedCodec) || c.mimeType.toLowerCase() === "video/rtx"));
    }
    peer.addEventListener("track", event => {
      if (active === session && event.track.kind === "video") {
        video.srcObject = event.streams[0] || new MediaStream([event.track]);
        video.play().catch(() => {});
      } else if (active === session && event.track.kind === "audio") {
        audio.srcObject = new MediaStream([event.track]);
        playAudio(session);
      }
    });
    peer.addEventListener("connectionstatechange", () => {
      if (active !== session) return;
      if (peer.connectionState === "failed") {
        const message = peer.iceConnectionState === "failed"
          ? "WebRTC could not find a working network path to the server."
          : "The WebRTC transport failed.";
        finish(session, message, "error", false, true);
      } else if (peer.connectionState === "disconnected") {
        stopCapture(session);
        desktopControls(session);
        if (!session.disconnectTimer) {
          session.disconnectTimer = setTimeout(() =>
            finish(session, "The connection was interrupted.", "error", true, true), 8000);
        }
        show("Connection interrupted. Waiting briefly for the network…", "connecting");
      } else if (peer.connectionState === "connected" && session.authorized && video.videoWidth) {
        clearTimeout(session.disconnectTimer);
        session.disconnectTimer = null;
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
      connecting(session, "Checking password…", "The host did not reply to the password check.");
      send(session, { type: "auth", password: session.password });
      session.password = "";
    });
    channel.addEventListener("close", () => finish(session, "The control channel closed.", "idle", false, true));
    channel.addEventListener("message", event => {
      if (active !== session) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message?.type === "ready" && !session.authorized) {
        session.authorized = true;
        session.canInput = message.input === true;
        session.features = message.features || {};
        session.audioState = "starting";
        updateAudio(session);
        playAudio(session);
        session.resolutions = Array.isArray(message.resolutions) ? message.resolutions : [];
        resolutionSelect.replaceChildren(...resolutionSizes.map(size => {
          const option = new Option(size === "native" ? "Host size (within codec limits)" : size.replace("x", "×"), size);
          option.disabled = !session.resolutions.includes(size);
          return option;
        }));
        resolutionSelect.value = message.resolution || "1280x720";
        if (selectedResolution && session.resolutions.includes(selectedResolution) && selectedResolution !== message.resolution)
          session.restoreResolution = selectedResolution;
        document.querySelector("#resolution-status").textContent = session.features.resolutions
          ? `Fits within the selected size; no stretching or upscaling. Windows display mode stays the same.${message.videoCodec === "AV1" ? " This AV1 session is limited to 1280×720." : ""}`
          : "This host needs the resolution update.";
        session.fileToken = session.features.files ? message.fileToken : null;
        session.maxFPS = message.maxFPS || 60;
        for (const option of fpsSelect.options) option.disabled = Number(option.value) > session.maxFPS;
        if (message.videoCodec) document.querySelector("#codec-status").textContent =
          `${message.videoCodec} · ${message.encoder || "host encoder"}${message.videoCodec === "AV1" ? " · up to 720p/30 FPS for the negotiated AV1 level" : ""}. Changing codec reconnects this session.`;
        fileStatus.textContent = session.features.files ? "Ready. Maximum file size: 16 GiB." : "Restart the updated host to enable file transfer.";
        if (session.features.videoSettings) {
          fpsSelect.value = String(message.fps);
          if (selectedFPS && selectedFPS !== message.fps) session.restoreFPS = Math.min(selectedFPS, session.maxFPS);
        }
        if (session.features.clipboardSync) {
          session.clip = { baseline: false, busy: false, pending: null, remote: null };
          session.clipboardTimer = setInterval(() => syncClipboard(session), 750);
          syncClipboard(session);
        } else clipboardStatus.textContent = "Restart the updated host to enable automatic bidirectional text sync.";
        session.intent.connected = true;
        session.lastPong = Date.now();
        if (session.features.monitors) session.pendingControl = "monitors-get";
        else if (session.restoreFPS || session.restoreResolution) completeControl(session);
        help.textContent = session.canInput
          ? "Click the desktop to send input. Ctrl+Alt+Esc releases keyboard and mouse capture."
          : "Local preview. Open the remote viewer on another device for control.";
        connecting(session, "Waiting for the remote desktop…",
          "Password accepted, but desktop video did not start.");
        session.pingTimer = setInterval(() => heartbeat(session), 5000);
        heartbeat(session);
        session.statsTimer = setInterval(() => showRoute(session), 2000);
        showRoute(session);
        if (video.videoWidth && video.readyState >= 2) showDesktop(session);
        if (!message.features && session.canInput) {
          controlStatus.textContent = "Restart the host to enable the new desktop controls.";
        }
      } else if (message?.type === "pong" && session.authorized) {
        session.lastPong = Date.now();
      } else if (message?.type === "monitors" && session.authorized) {
        session.displays = Array.isArray(message.displays) ? message.displays.filter(display =>
          Number.isInteger(display.id) && display.id > 0 && display.width > 0 && display.height > 0
        ).slice(0, 64) : [];
        monitorSelect.replaceChildren(...session.displays.map(display =>
          new Option(`Display ${display.id} · ${display.width}×${display.height}`, display.id)));
        monitorSelect.value = String(message.selected);
        session.selectedMonitor = monitorSelect.value;
        completeControl(session);
      } else if (message?.type === "video-settings" && session.authorized) {
        selectedFPS = message.fps;
        fpsSelect.value = String(message.fps);
        if (message.resolution) {
          selectedResolution = message.resolution;
          resolutionSelect.value = message.resolution;
        }
        document.querySelector("#video-status").textContent = `Host limit applied: ${message.fps} FPS. Actual delivery is shown in Performance measurements.`;
        completeControl(session);
      } else if (message?.type === "audio-state" && session.authorized) {
        session.audioState = message.state;
        updateAudio(session);
      } else if (message?.type === "clipboard-sync" && session.authorized && session.clip) {
        if (typeof message.text === "string" && new TextEncoder().encode(message.text).length <= 8192) {
          session.clip.remote = {text: message.text};
          syncClipboard(session);
        }
      } else if (message?.type === "clipboard-synced" && session.authorized && session.clip) {
        session.clip.last = message.text;
        session.clip.pending = null;
      } else if (message?.type === "clipboard-text" && session.authorized) {
        clipboardText.value = message.text;
        completeControl(session);
        controlStatus.textContent = "Text received from the host. Choose Copy locally to use it here.";
      } else if (message?.type === "clipboard-set" && session.authorized) {
        completeControl(session);
        controlStatus.textContent = "The remote clipboard was updated.";
      } else if (message?.type === "control-error" && session.authorized) {
        if (message.operation === "clipboard-sync") {
          if (session.clip) session.clip.pending = null;
          clipboardStatus.textContent = message.message;
          return;
        }
        completeControl(session);
        monitorSelect.value = session.selectedMonitor || "";
        controlStatus.textContent = message.message;
      } else if (message?.type === "codec-error" && session.authorized) {
        selectedCodec = "auto";
        selectedFPS = Math.min(selectedFPS || 20, 30);
        finish(session, message.message, "connecting", true, true);
      } else if (message?.type === "denied" || message?.type === "error") {
        finish(session, message.message, "error");
      } else if (message?.type === "input-error") {
        show(message.message, "error");
      }
    });
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIce(peer, signal);
    if (active !== session) return;
    connecting(session, "Waiting for the server’s WebRTC answer…", "The server’s WebRTC answer timed out.");
    const answer = await requestJSON(base, "offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(peer.localDescription),
      signal,
    });
    if (active === session) {
      connecting(session, "Checking WebRTC network paths…",
        "The server answered, but WebRTC timed out checking network paths.");
      await peer.setRemoteDescription(answer);
    }
  } catch (error) {
    const retryable = !error.status || [408, 409, 429, 500, 502, 503, 504].includes(error.status);
    finish(session, error.message || "Connection failed.", "error", false, retryable);
  }
}

function showDesktop(session) {
  if (active !== session || !session.authorized || session.peer.connectionState !== "connected") return;
  clearTimeout(session.connectTimer);
  clearTimeout(session.disconnectTimer);
  session.disconnectTimer = null;
  session.intent.attempt = 0;
  empty.hidden = true;
  document.body.classList.add("connected");
  desktopControls(session);
  show(session.canInput ? "Connected to the remote desktop." : "Previewing the remote desktop.", "connected");
}

video.addEventListener("playing", () => {
  if (active) showDesktop(active);
});

form.addEventListener("submit", event => {
  event.preventDefault();
  const value = passwordField.value;
  if (Array.from(value).length < 8 || new TextEncoder().encode(value).length > 256) {
    show("Use the password set on the host. It must be at least eight characters.", "error");
    return;
  }
  try { signalingBase(serverField.value); }
  catch (error) { show(error.message, "error"); serverField.focus(); return; }
  passwordField.value = "";
  allowClipboard();
  connect(value);
});
disconnectButton.addEventListener("click", () => {
  if (active) finish(active, "Disconnected.", "idle", true);
  else {
    forgetConnection();
    connectButton.disabled = false;
    disconnectButton.disabled = true;
    serverField.disabled = passwordField.disabled = false;
    show("Disconnected.");
  }
});
window.addEventListener("pagehide", () => {
  if (active) finish(active, "Disconnected.", "idle", true);
  else forgetConnection();
});
window.addEventListener("online", () => {
  if (!desired) return;
  if (!active) {
    clearTimeout(desired.timer);
    connect(desired.password, desired);
  } else if (active.peer?.connectionState === "disconnected") {
    finish(active, "The network returned.", "idle", true, true);
  }
});
window.addEventListener("offline", () => {
  if (active) finish(active, "Network offline.", "idle", true, true);
  else if (desired) {
    clearTimeout(desired.timer);
    reconnect(desired, "Network offline.");
  }
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
  if (event.code === "KeyV" && event.ctrlKey && !event.altKey && session.features.clipboardSync) {
    if (!event.repeat) pasteClipboard(session);
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
  else if (active?.authorized) heartbeat(active);
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
    controlStatus.textContent = "Local text loaded. Choose Send to host to transfer it.";
  } catch {
    clipboardText.focus();
    controlStatus.textContent = "Paste into the text box with Ctrl+V, then choose Send to host.";
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

function setMenu(open) {
  sessionMenu.hidden = !open;
  menuToggle.setAttribute("aria-expanded", String(open));
  if (!open) menuToggle.focus({preventScroll: true});
}
menuToggle.addEventListener("click", () => setMenu(sessionMenu.hidden));
document.querySelector("#menu-close").addEventListener("click", () => setMenu(false));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !sessionMenu.hidden && document.pointerLockElement !== video) setMenu(false);
});
document.querySelector("#scale-fit").addEventListener("change", event => {
  document.body.classList.toggle("native-size", !event.target.checked);
});
document.querySelector("#smooth-scale").addEventListener("change", event => {
  document.body.classList.toggle("crisp", !event.target.checked);
});
fpsSelect.addEventListener("change", () => {
  if (active?.features?.videoSettings) requestControl(active, {type: "video-settings", fps: Number(fpsSelect.value)});
});
codecSelect.addEventListener("change", () => {
  const session = active;
  if (!session?.authorized || !desired) return;
  selectedCodec = codecSelect.value;
  finish(session, "Applying the video codec.", "connecting", true, true);
});

async function localClipboardText() {
  if (navigator.clipboard?.read) {
    const items = await navigator.clipboard.read();
    if (!items.length) return "";
    for (const item of items) {
      if (item.types.includes("text/plain")) return (await item.getType("text/plain")).text();
    }
    return null;
  }
  const text = await navigator.clipboard.readText();
  return text || null;
}
async function allowClipboard() {
  if (!navigator.clipboard?.readText || !navigator.clipboard?.writeText) {
    clipboardStatus.textContent = "This browser cannot sync the clipboard automatically. Manual text transfer remains available.";
    return;
  }
  try {
    await localClipboardText();
    clipboardAllowed = true;
    clipboardStatus.textContent = "Bidirectional text sync active while this page has focus.";
    if (active?.clip) syncClipboard(active);
  } catch {
    clipboardAllowed = false;
    clipboardStatus.textContent = "Clipboard permission is blocked. Use Allow clipboard access, or the manual text transfer below.";
  }
}
document.querySelector("#clipboard-enable").addEventListener("click", allowClipboard);
async function syncClipboard(session) {
  const clip = session.clip;
  if (active !== session || !clipboardAllowed || !clip || clip.busy || clip.pending !== null ||
      document.hidden || !document.hasFocus()) return;
  clip.busy = true;
  try {
    const text = await localClipboardText();
    if (active !== session) return;
    if (!clip.baseline) {
      clip.last = text;
      clip.baseline = true;
    }
    if (text !== null && text !== clip.last) {
      if (new TextEncoder().encode(text).length > 8192 || text.includes("\0")) {
        clipboardStatus.textContent = "Clipboard text exceeds 8 KiB or contains a null character; it was left unchanged.";
        return;
      }
      if (session.pendingControl) return;
      clip.remote = null;
      clip.pending = text;
      send(session, {type: "clipboard-sync", text});
    } else if (clip.remote) {
      if (text === null) {
        clipboardStatus.textContent = "The local clipboard has no plain text; pending remote text is waiting to avoid replacing files or images.";
        return;
      }
      const remote = clip.remote;
      await navigator.clipboard.writeText(remote.text);
      if (active !== session) return;
      clip.last = remote.text;
      if (clip.remote === remote) clip.remote = null;
    }
    clipboardStatus.textContent = "Bidirectional text sync active while this page has focus.";
  } catch {
    clipboardAllowed = false;
    clipboardStatus.textContent = "Clipboard access paused by the browser. Use Allow clipboard access to resume.";
  } finally { clip.busy = false; }
}
async function pasteClipboard(session) {
  let locked = false;
  try {
    if (!clipboardAllowed) throw new Error("Allow clipboard access before pasting local text.");
    const deadline = Date.now() + 3000;
    while (session.pendingControl || session.clip?.pending !== null || session.clip?.busy) {
      if (Date.now() > deadline) throw new Error("Clipboard sync is still running. Try paste again.");
      await new Promise(resolve => setTimeout(resolve, 25));
      if (active !== session) return;
    }
    session.clip.busy = true;
    locked = true;
    const text = await localClipboardText();
    if (active !== session) return;
    if (text === null) throw new Error("Local clipboard has no supported plain text.");
    if (new TextEncoder().encode(text).length > 8192 || text.includes("\0")) throw new Error("Clipboard text exceeds 8 KiB or contains a null character.");
    session.clip.pending = text;
    send(session, {type: "clipboard-sync", text, paste: true});
  } catch (error) {
    clipboardStatus.textContent = error.message;
    if (active === session) {
      show(error.message, "error");
      setTimeout(() => { if (active === session && status.textContent === error.message) showDesktop(session); }, 4000);
    }
  } finally { if (locked) session.clip.busy = false; }
}
window.addEventListener("focus", () => { if (active?.clip) syncClipboard(active); });

function updateAudio(session) {
  if (active !== session) return;
  audioToggle.textContent = session.audioBlocked ? "Enable sound" : audioWanted ? "Mute sound" : "Unmute sound";
  if (!session.features?.audio) audioStatus.textContent = "This host does not provide desktop audio.";
  else if (!audioWanted || Number(audioVolume.value) === 0) audioStatus.textContent = "Sound muted in this browser.";
  else if (session.audioState === "unavailable") audioStatus.textContent = "The host’s playback output is unavailable. Retrying automatically; video stays connected.";
  else if (session.audioBlocked) audioStatus.textContent = "This browser blocked sound. Click Enable sound to allow playback.";
  else audioStatus.textContent = session.audioState === "capturing" ? "Windows playback → Opus · 48 kHz stereo. No microphone." : "Waiting for remote audio…";
}
async function playAudio(session) {
  if (active !== session) return;
  audio.muted = !session.authorized || !audioWanted;
  audio.volume = Number(audioVolume.value) / 100;
  if (session.authorized && session.features?.audio && audioWanted && audio.srcObject) {
    try { await audio.play(); session.audioBlocked = false; }
    catch { session.audioBlocked = true; }
  }
  updateAudio(session);
}
audioToggle.addEventListener("click", () => {
  if (!active?.features?.audio) return;
  if (!active.audioBlocked) audioWanted = !audioWanted;
  else audioWanted = true;
  playAudio(active);
});
audioVolume.addEventListener("input", () => { if (active) playAudio(active); });
resolutionSelect.addEventListener("change", () => {
  if (active?.features?.resolutions) requestControl(active, {type: "video-settings", resolution: resolutionSelect.value});
});

function fileSize(bytes) {
  return bytes < 1024**2 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024**2).toFixed(1)} MiB`;
}
function fileOptions(session, extra = {}) {
  return {signal: session.fileAbort.signal, ...extra, headers: {Authorization: `Bearer ${session.fileToken}`, ...extra.headers}};
}
async function fileOperation(action) {
  const session = active;
  if (!session?.authorized || !session.features.files || session.fileBusy || session.fileCancelling) return;
  session.fileBusy = true;
  session.fileAbort = new AbortController();
  const progress = document.querySelector("#file-progress");
  progress.hidden = false;
  progress.value = 0;
  desktopControls(session);
  try { await action(session, progress); }
  catch (error) {
    if (active === session) fileStatus.textContent = error.name === "AbortError" ? "File operation cancelled." : (error.message || "File transfer failed.");
  } finally {
    session.fileBusy = false;
    if (active === session) { progress.hidden = true; desktopControls(session); }
  }
}
document.querySelector("#file-upload").addEventListener("change", event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  fileOperation(async (session, progress) => {
    if (file.size > 16 * 1024**3) throw new Error("Files must be at most 16 GiB.");
    fileStatus.textContent = `Uploading ${file.name}…`;
    const ticket = await requestJSON(session.base, "files/upload", fileOptions(session, {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name: file.name, size: file.size}),
    }));
    const result = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      xhr.open("PUT", new URL(`files/upload/${ticket.id}`, session.base));
      xhr.setRequestHeader("Authorization", `Bearer ${session.fileToken}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = e => { if (e.lengthComputable) progress.value = 100 * e.loaded / e.total; };
      const cleanup = () => session.fileAbort.signal.removeEventListener("abort", abort);
      xhr.onload = () => {
        cleanup();
        let payload; try { payload = JSON.parse(xhr.responseText); } catch { /* handled below */ }
        if (xhr.status >= 200 && xhr.status < 300 && payload) resolve(payload);
        else reject(new Error(payload?.error || `Upload failed (HTTP ${xhr.status}).`));
      };
      xhr.onerror = () => { cleanup(); reject(new Error("The upload connection failed.")); };
      xhr.onabort = () => { cleanup(); reject(new DOMException("Cancelled", "AbortError")); };
      session.fileAbort.signal.addEventListener("abort", abort, {once: true});
    if (session.fileAbort.signal.aborted) {
      cleanup(); reject(new DOMException("Cancelled", "AbortError"));
    } else xhr.send(file);
    });
    if (active === session) fileStatus.textContent = `Uploaded ${result.name} (${fileSize(result.size)}) to ${result.folder}.`;
  });
});
document.querySelector("#file-pick").addEventListener("click", () => fileOperation(async session => {
  fileStatus.textContent = "Choose a file in the picker on the remote desktop. Cancel is available here.";
  const selected = await requestJSON(session.base, "files/pick", fileOptions(session, {method: "POST"}));
  if (active !== session) return;
  session.download = selected.cancelled ? null : selected;
  document.querySelector("#file-selected").textContent = session.download ? `${selected.name} · ${fileSize(selected.size)}` : "No download selected.";
  fileStatus.textContent = selected.cancelled ? "File selection cancelled." : "Ready to download.";
}));
document.querySelector("#file-download").addEventListener("click", () => fileOperation(async (session, progress) => {
  const selected = session.download;
  let writable = null;
  try {
    if (globalThis.showSaveFilePicker) {
      // Called before awaiting the network, while this click still grants user activation.
      try {
        const handle = await showSaveFilePicker({suggestedName: selected.name});
        writable = await handle.createWritable();
      } catch (error) {
        if (!["SecurityError", "NotAllowedError", "NotSupportedError"].includes(error.name)) throw error;
      }
    }
    if (!writable && session.features.browserDownloads) {
      const grant = await requestJSON(session.base, "files/browser-download", fileOptions(session, {
        method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id: selected.id}),
      }));
      if (active !== session || session.fileAbort.signal.aborted) return;
      const target = new URL(grant.path, session.base);
      if (target.origin !== session.base.origin || !target.pathname.startsWith(session.base.pathname + "files/browser-download/"))
        throw new Error("The host returned an invalid download link.");
      const link = document.createElement("a");
      link.href = target; link.target = "remmie-download"; link.referrerPolicy = "no-referrer";
      document.body.append(link); link.click(); link.remove();
      fileStatus.textContent = `Sent ${selected.name} to browser downloads. Check progress or cancel in your browser’s download manager.`;
      return;
    }
    if (!writable && selected.size > 128 * 1024**2)
      throw new Error("This older host needs the browser-download update for files above 128 MiB when Save File Picker is unavailable.");
    fileStatus.textContent = `Downloading ${selected.name}…`;
    const response = await fetch(new URL(`files/download/${selected.id}`, session.base), {
      cache: "no-store", credentials: "omit", redirect: "error", ...fileOptions(session),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `Download failed (HTTP ${response.status}).`);
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > selected.size) { await reader.cancel(); throw new Error("File size changed during the transfer."); }
      if (writable) await writable.write(value); else chunks.push(value);
      progress.value = selected.size ? 100 * total / selected.size : 100;
    }
    if (total !== selected.size) throw new Error("The download was incomplete.");
    if (writable) { await writable.close(); writable = null; }
    else {
      const url = URL.createObjectURL(new Blob(chunks));
      const link = document.createElement("a");
      link.href = url; link.download = selected.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    if (active === session) fileStatus.textContent = `Downloaded ${selected.name} (${fileSize(total)}).`;
  } finally { if (writable) await writable.abort().catch(() => {}); }
}));
document.querySelector("#file-cancel").addEventListener("click", () => {
  const session = active;
  if (!session?.fileBusy) return;
  session.fileCancelling = true;
  desktopControls(session);
  session.fileAbort.abort();
  requestJSON(session.base, "files/cancel", {method: "POST", headers: {Authorization: `Bearer ${session.fileToken}`}, signal: session.abort.signal})
    .catch(() => { if (active === session) fileStatus.textContent = "Cancellation was not acknowledged. Reconnect before starting another transfer."; })
    .finally(() => { session.fileCancelling = false; if (active === session) desktopControls(session); });
});
