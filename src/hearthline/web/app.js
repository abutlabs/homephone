// Hearthline laptop test phone.
// Talks to the ringing server over a WebSocket and to LiveKit for audio.
(() => {
  const params = new URLSearchParams(location.search);
  const KEY = params.get("key") || "";
  const HOUSEHOLD = params.get("household") || "laptop";
  const NAME = params.get("name") || "Laptop";

  const $ = (id) => document.getElementById(id);
  const ui = {
    me: $("me"), conn: $("conn"), state: $("call-state"), answer: $("answer"),
    decline: $("decline"), hangup: $("hangup"), mute: $("mute"), meters: $("meters"),
    lvlLocal: $("lvl-local"), lvlRemote: $("lvl-remote"), audio: $("audio"),
    households: $("households"), phones: $("phones"), unlock: $("unlock"),
    unlockBox: $("unlock-box"),
  };
  ui.me.textContent = HOUSEHOLD;

  let ws = null;
  let households = [];
  let call = null;      // {id, role: "caller"|"callee", state}
  let room = null;
  let meterTimer = null;

  function send(type, fields = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...fields }));
  }

  // ---- UI -----------------------------------------------------------------
  function setState(text, ringing = false) {
    ui.state.textContent = text;
    ui.state.classList.toggle("ringing", ringing);
  }

  function render() {
    const s = call ? call.state : "idle";
    ui.answer.hidden = s !== "ringing";
    ui.decline.hidden = s !== "ringing";
    ui.hangup.hidden = !["calling", "in_call", "joining"].includes(s);
    ui.mute.hidden = s !== "in_call";
    ui.meters.hidden = s !== "in_call";
    for (const b of ui.households.querySelectorAll("button")) b.disabled = !!call;
  }

  function renderHouseholds() {
    ui.households.innerHTML = "";
    const others = households.filter((h) => h.id !== HOUSEHOLD);
    if (!others.length) {
      ui.households.innerHTML = '<li class="empty">No other households yet. Start a phone.</li>';
      return;
    }
    for (const h of others) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${esc(h.name)} <span class="meta">${esc(h.id)}</span></span>`;
      const b = document.createElement("button");
      b.textContent = "Call";
      b.className = "primary";
      b.onclick = () => placeCall(h.id);
      li.appendChild(b);
      ui.households.appendChild(li);
    }
    render();
  }

  function renderPhones(phones) {
    ui.phones.innerHTML = "";
    if (!phones.length) {
      ui.phones.innerHTML = '<li class="empty">No phones connected.</li>';
      return;
    }
    for (const p of phones) {
      const li = document.createElement("li");
      const hears = p.state === "in_call" ? ` · hears <meter min="0" max="0.2" value="${p.audio_level || 0}"></meter>` : "";
      li.innerHTML = `<span>${esc(p.name)} <span class="meta">${esc(p.household)} · ${esc(p.state || "?")}` +
        `${p.off_hook ? " · handset up" : ""}${hears}</span></span>`;
      if (p.mock) {
        const b = document.createElement("button");
        b.textContent = p.off_hook ? "Hang up phone" : "Lift handset";
        b.onclick = () => send("mock_hook", { address: p.address, off_hook: !p.off_hook });
        li.appendChild(b);
      }
      ui.phones.appendChild(li);
    }
    // Refresh the household list too: phones may have created new households.
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- calls --------------------------------------------------------------
  function placeCall(to) {
    if (call) return;
    call = { id: null, role: "caller", state: "dialing" };
    setState(`Calling ${to}…`);
    render();
    send("call", { to });
  }

  async function joinRoom(url, token) {
    const LK = window.LivekitClient;
    room = new LK.Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true } });
    room.on(LK.RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === LK.Track.Kind.Audio) ui.audio.appendChild(track.attach());
    });
    room.on(LK.RoomEvent.Disconnected, () => { room = null; });
    await room.connect(url, token);
    await room.localParticipant.setMicrophoneEnabled(true);
    meterTimer = setInterval(() => {
      if (!room) return;
      ui.lvlLocal.value = room.localParticipant.audioLevel || 0;
      let remote = 0;
      for (const p of room.remoteParticipants.values()) remote = Math.max(remote, p.audioLevel || 0);
      ui.lvlRemote.value = remote;
    }, 200);
  }

  async function leaveRoom() {
    clearInterval(meterTimer);
    meterTimer = null;
    if (room) {
      const r = room;
      room = null;
      await r.disconnect();
    }
    ui.audio.innerHTML = "";
  }

  async function endLocal(text) {
    Tones.stop();
    await leaveRoom();
    call = null;
    setState(text);
    render();
  }

  async function onMessage(msg) {
    switch (msg.type) {
      case "welcome":
        households = msg.households || [];
        ui.conn.textContent = "online";
        ui.conn.classList.add("on");
        renderHouseholds();
        break;
      case "phones": {
        renderPhones(msg.phones || []);
        const ids = new Set(households.map((h) => h.id));
        let changed = false;
        for (const p of msg.phones || []) {
          if (!ids.has(p.household)) { households.push({ id: p.household, name: p.household }); changed = true; }
        }
        if (changed) renderHouseholds();
        break;
      }
      case "calling":
        if (!call) { send("hangup", { call_id: msg.call_id }); break; }
        call.id = msg.call_id;
        call.state = "calling";
        Tones.ringback();
        render();
        await joinRoom(msg.url, msg.token);
        break;
      case "answered":
        if (!call || call.id !== msg.call_id) break;
        Tones.stop();
        call.state = "in_call";
        setState(`In a call with ${msg.by}`);
        render();
        break;
      case "ring":
        if (call) { send("hangup", { call_id: msg.call_id }); break; }
        call = { id: msg.call_id, role: "callee", state: "ringing", from: msg.from };
        setState(`${msg.from.name} (${msg.from.household}) is calling…`, true);
        Tones.ring();
        render();
        break;
      case "join":
        if (!call || call.id !== msg.call_id) break;
        call.state = "joining";
        render();
        await joinRoom(msg.url, msg.token);
        call.state = "in_call";
        setState(`In a call with ${call.from.name}`);
        render();
        break;
      case "stop_ring":
        if (call && call.id === msg.call_id) await endLocal(msg.reason === "answered_elsewhere" ? "Answered on another phone" : "Missed call");
        break;
      case "ended":
        if (call && (call.id === msg.call_id || !call.id)) {
          const reasons = { hung_up: "Call ended", no_answer: "No answer", unavailable: "Nobody is online there", declined: "Declined", no_such_household: "No such household" };
          await endLocal(reasons[msg.reason] || "Call ended");
        }
        break;
      case "error":
        setState(`Error: ${msg.message}`);
        break;
    }
  }

  ui.answer.onclick = () => { Tones.stop(); send("answer", { call_id: call.id }); };
  ui.decline.onclick = () => { send("hangup", { call_id: call.id }); endLocal("Declined"); };
  ui.hangup.onclick = () => { if (call && call.id) send("hangup", { call_id: call.id }); endLocal("Call ended"); };
  ui.mute.onclick = async () => {
    if (!room) return;
    const on = room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(!on);
    ui.mute.textContent = on ? "Unmute" : "Mute";
  };
  ui.unlock.onclick = async () => {
    Tones.unlock();
    try {
      // Ask for the microphone now, so answering a call is instant.
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch (e) { setState("Microphone blocked: allow it in the address bar"); }
    ui.unlockBox.hidden = true;
  };

  // ---- connection -----------------------------------------------------------
  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "challenge") {
        send("hello", { kind: "web", key: KEY, household: HOUSEHOLD, name: NAME });
        return;
      }
      try { await onMessage(msg); } catch (e) { console.error(e); setState(`Error: ${e.message}`); }
    };
    ws.onclose = () => {
      ui.conn.textContent = "offline";
      ui.conn.classList.remove("on");
      if (call) endLocal("Connection lost");
      setTimeout(connect, 2000);
    };
  }

  if (!KEY) setState("Open the link the server printed (it includes ?key=…)");
  render();
  connect();
})();
