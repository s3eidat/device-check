/* Device Check — camera, mic, speakers, screen and keyboard tests. Media is only opened on a click and never leaves the page. */
(function () {
  "use strict";
  var $ = S3.$, $$ = S3.$$;
  var md = navigator.mediaDevices;

  // ---------- pure helpers (tested in S3_SELFTEST) ----------
  var RATES = [24, 30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 280, 360];
  function median(a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s.length ? s[s.length >> 1] : NaN; }
  function refreshHz(deltas) {
    var raw = 1000 / median(deltas);
    if (!isFinite(raw)) return null;
    var best = RATES.reduce(function (b, r) { return Math.abs(r - raw) < Math.abs(b - raw) ? r : b; }, RATES[0]);
    return Math.abs(best - raw) / best < 0.03 ? best : Math.round(raw);
  }
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function ratioName(w, h) {
    if (!w || !h) return "—";
    var known = [["16:9", 16 / 9], ["16:10", 1.6], ["4:3", 4 / 3], ["5:4", 1.25], ["3:2", 1.5], ["21:9", 64 / 27], ["32:9", 32 / 9], ["1:1", 1], ["9:16", 9 / 16], ["3:4", 0.75], ["10:16", 0.625]];
    for (var i = 0; i < known.length; i++) if (Math.abs(w / h - known[i][1]) / known[i][1] < 0.015) return known[i][0];
    var g = gcd(w, h); return w / g + ":" + h / g;
  }
  function rmsDb(buf) { var s = 0; for (var i = 0; i < buf.length; i++) s += buf[i] * buf[i]; var r = Math.sqrt(s / buf.length); return r > 0 ? 20 * Math.log10(r) : -Infinity; }
  function peakDb(buf) { var p = 0; for (var i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i])); return p > 0 ? 20 * Math.log10(p) : -Infinity; }
  function dbToPct(db) { return Math.max(0, Math.min(100, (db + 60) / 60 * 100)); }
  function sweepFreq(t, dur) { return 20 * Math.pow(1000, Math.min(1, Math.max(0, t / dur))); }
  function playChime(ctx, dest, pan, when, vol) {
    var p = ctx.createStereoPanner(), g = ctx.createGain();
    p.pan.value = pan; g.connect(p); p.connect(dest);
    [0, 0.45].forEach(function (off) {
      [[880, 1], [1320, 0.4], [1760, 0.15]].forEach(function (h) {
        var o = ctx.createOscillator(), og = ctx.createGain(), t = when + off;
        o.frequency.value = h[0] * (off ? 1.122 : 1);
        og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(h[1] * vol * 0.4, t + 0.008); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.connect(og); og.connect(g); o.start(t); o.stop(t + 0.95);
      });
    });
  }
  // ANSI-ish layout: [code, label, width]
  var LAYOUT = [
    [["Escape", "Esc"], ["F1"], ["F2"], ["F3"], ["F4"], ["F5"], ["F6"], ["F7"], ["F8"], ["F9"], ["F10"], ["F11"], ["F12"], ["Delete", "Del", 1.5]],
    [["Backquote", "`"], ["Digit1", "1"], ["Digit2", "2"], ["Digit3", "3"], ["Digit4", "4"], ["Digit5", "5"], ["Digit6", "6"], ["Digit7", "7"], ["Digit8", "8"], ["Digit9", "9"], ["Digit0", "0"], ["Minus", "-"], ["Equal", "="], ["Backspace", "⌫", 2]],
    [["Tab", "Tab", 1.5], ["KeyQ", "Q"], ["KeyW", "W"], ["KeyE", "E"], ["KeyR", "R"], ["KeyT", "T"], ["KeyY", "Y"], ["KeyU", "U"], ["KeyI", "I"], ["KeyO", "O"], ["KeyP", "P"], ["BracketLeft", "["], ["BracketRight", "]"], ["Backslash", "\\", 1.5]],
    [["CapsLock", "Caps", 1.75], ["KeyA", "A"], ["KeyS", "S"], ["KeyD", "D"], ["KeyF", "F"], ["KeyG", "G"], ["KeyH", "H"], ["KeyJ", "J"], ["KeyK", "K"], ["KeyL", "L"], ["Semicolon", ";"], ["Quote", "'"], ["Enter", "Enter", 2.25]],
    [["ShiftLeft", "Shift", 2.25], ["KeyZ", "Z"], ["KeyX", "X"], ["KeyC", "C"], ["KeyV", "V"], ["KeyB", "B"], ["KeyN", "N"], ["KeyM", "M"], ["Comma", ","], ["Period", "."], ["Slash", "/"], ["ShiftRight", "Shift", 1.75], ["ArrowUp", "↑"]],
    [["ControlLeft", "Ctrl", 1.25], ["MetaLeft", "Win/⌘", 1.25], ["AltLeft", "Alt", 1.25], ["Space", "", 5.5], ["AltRight", "Alt", 1.25], ["ControlRight", "Ctrl", 1.25], ["ArrowLeft", "←"], ["ArrowDown", "↓"], ["ArrowRight", "→"]]
  ];

  // ---------- small UI helpers ----------
  function kv(el, rows) { el.innerHTML = ""; rows.forEach(function (r) { if (r[1] == null || r[1] === "") return; el.appendChild(S3.h("dt", { text: r[0] })); el.appendChild(S3.h("dd", { text: String(r[1]) })); }); }
  function chip(el, text, kind) { el.textContent = text; el.className = "chip" + (kind ? " " + kind : ""); }
  function mediaError(e, what) {
    var n = e && e.name;
    if (n === "NotAllowedError" || n === "SecurityError") return what + " access was blocked. Allow it from the address bar (lock or " + what.toLowerCase() + " icon) and try again.";
    if (n === "NotFoundError" || n === "DevicesNotFoundError") return "No " + what.toLowerCase() + " was found.";
    if (n === "NotReadableError" || n === "TrackStartError") return "The " + what.toLowerCase() + " is busy: another app or tab is using it.";
    if (n === "OverconstrainedError") return "The " + what.toLowerCase() + " doesn't support that setting. Try another resolution.";
    return "Couldn't open the " + what.toLowerCase() + ": " + (e && e.message || e);
  }
  function noMedia() { return window.isSecureContext === false ? "Needs a secure page (https or localhost)." : "This browser can't access cameras or microphones."; }
  async function fillDevices(kind, sel) {
    if (!md || !md.enumerateDevices) return;
    var cur = sel.value, list = (await md.enumerateDevices()).filter(function (d) { return d.kind === kind; });
    sel.innerHTML = "";
    sel.appendChild(S3.h("option", { value: "", text: kind === "videoinput" ? "Default camera" : "Default microphone" }));
    list.forEach(function (d, i) { if (d.deviceId && d.deviceId !== "default") sel.appendChild(S3.h("option", { value: d.deviceId, text: d.label || (kind === "videoinput" ? "Camera " : "Microphone ") + (i + 1) })); });
    sel.value = cur;
    if (sel.value !== cur) sel.value = "";
  }

  // ---------- camera ----------
  var cam = null, video = $("#camVideo");
  var RES = { 480: [640, 480], 720: [1280, 720], 1080: [1920, 1080], 2160: [3840, 2160] };
  async function startCam() {
    if (!md || !md.getUserMedia) { chip($("#camStatus"), "Unavailable", "bad"); return camMsg(noMedia()); }
    stopCam(true);
    var v = {}, dev = $("#camDev").value, res = RES[$("#camRes").value];
    if (dev) v.deviceId = { exact: dev };
    if (res) { v.width = { ideal: res[0] }; v.height = { ideal: res[1] }; }
    chip($("#camStatus"), "Starting…");
    try { cam = { stream: await md.getUserMedia({ video: Object.keys(v).length ? v : true }), fps: 0 }; }
    catch (e) { chip($("#camStatus"), "Error", "bad"); return camMsg(mediaError(e, "Camera")); }
    video.srcObject = cam.stream; video.hidden = false; $("#camEmpty").hidden = true;
    await video.play().catch(function () {});
    chip($("#camStatus"), "● Live", "ok"); $("#camStart span").textContent = "Stop camera"; $("#camSnap").disabled = false;
    fillDevices("videoinput", $("#camDev"));
    measureFps(); camInfo(); S3.done();
  }
  function stopCam(quiet) {
    if (!cam) return;
    cam.stream.getTracks().forEach(function (t) { t.stop(); }); cam = null; video.srcObject = null; video.hidden = true;
    if (!quiet) { $("#camEmpty").hidden = false; camMsg("Camera off"); chip($("#camStatus"), "Off"); $("#camStart span").textContent = "Start camera"; $("#camSnap").disabled = true; $("#camInfo").innerHTML = ""; }
  }
  function camMsg(t, ok) { var e = $("#camEmpty"); e.hidden = false; e.className = "cam-empty" + (ok === false || /blocked|busy|No |Couldn|support|Needs|can't/.test(t) ? " err" : ""); e.lastChild.textContent = t; }
  function measureFps() {
    var c = cam; if (!c) return;
    var frames = 0, t0 = performance.now();
    function count() {
      if (cam !== c) return;
      frames++;
      var dt = performance.now() - t0;
      if (dt >= 1000) { c.fps = frames * 1000 / dt; frames = 0; t0 = performance.now(); camInfo(); }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(count); else setTimeout(count, 1000 / 60);
    }
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(count); else camInfo();
  }
  function camInfo() {
    if (!cam) return;
    var t = cam.stream.getVideoTracks()[0], s = t.getSettings ? t.getSettings() : {}, w = video.videoWidth || s.width, h = video.videoHeight || s.height;
    kv($("#camInfo"), [
      ["Device", t.label || "Camera"], ["Resolution", w && h ? w + " × " + h + " (" + ratioName(w, h) + ")" : "—"],
      ["Frame rate", cam.fps ? cam.fps.toFixed(1) + " fps measured" + (s.frameRate ? " · " + Math.round(s.frameRate) + " requested" : "") : s.frameRate ? Math.round(s.frameRate) + " fps" : "measuring…"],
      ["Facing", s.facingMode || ""]
    ]);
  }
  $("#camStart").addEventListener("click", function () { if (cam) stopCam(); else startCam(); });
  $("#camDev").addEventListener("change", function () { if (cam) startCam(); });
  $("#camRes").addEventListener("change", function () { if (cam) startCam(); });
  $("#mirror").addEventListener("change", function () { video.classList.toggle("mirror", this.checked); });
  video.classList.add("mirror");
  video.addEventListener("resize", camInfo);
  $("#camSnap").addEventListener("click", function () {
    if (!cam || !video.videoWidth) return;
    var c = document.createElement("canvas"); c.width = video.videoWidth; c.height = video.videoHeight;
    var g = c.getContext("2d"); if ($("#mirror").checked) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(video, 0, 0);
    c.toBlob(function (b) { if (b) { S3.download(b, "camera-" + c.width + "x" + c.height + ".png"); S3.done(); } }, "image/png");
  });

  // ---------- microphone ----------
  var mic = null, actx = null, peakHold = -Infinity, peakT = 0, recentMax = [];
  function audioCtx() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); return actx.resume().then(function () { return actx; }); }
  async function startMic() {
    if (!md || !md.getUserMedia) { chip($("#micStatus"), "Unavailable", "bad"); $("#micHint").textContent = noMedia(); return; }
    stopMic(true);
    var dev = $("#micDev").value;
    chip($("#micStatus"), "Starting…");
    var stream;
    try { stream = await md.getUserMedia({ audio: dev ? { deviceId: { exact: dev } } : true }); }
    catch (e) { chip($("#micStatus"), "Error", "bad"); $("#micHint").textContent = mediaError(e, "Microphone"); return; }
    var ctx = await audioCtx(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
    an.fftSize = 2048; src.connect(an);
    mic = { stream: stream, src: src, an: an, buf: new Float32Array(2048) };
    chip($("#micStatus"), "● Live", "ok"); $("#micStart span").textContent = "Stop microphone"; $("#micRec").disabled = typeof MediaRecorder !== "function";
    var t = stream.getAudioTracks()[0], s = t.getSettings ? t.getSettings() : {};
    kv($("#micInfo"), [["Device", t.label || "Microphone"], ["Sample rate", s.sampleRate ? s.sampleRate + " Hz" : ctx.sampleRate + " Hz"], ["Channels", s.channelCount || ""],
      ["Processing", ["echoCancellation", "noiseSuppression", "autoGainControl"].filter(function (k) { return s[k]; }).map(function (k) { return { echoCancellation: "echo cancel", noiseSuppression: "noise suppression", autoGainControl: "auto gain" }[k]; }).join(", ") || "none"]]);
    fillDevices("audioinput", $("#micDev"));
    micLoop(); S3.done();
  }
  function stopMic(quiet) {
    if (!mic) return;
    mic.stream.getTracks().forEach(function (t) { t.stop(); }); mic.src.disconnect(); mic = null;
    if (!quiet) { chip($("#micStatus"), "Off"); $("#micStart span").textContent = "Start microphone"; $("#micRec").disabled = true; $("#micLevel").style.width = "0"; $("#micDb").textContent = "— dB"; $("#micHint").textContent = ""; drawWave(null); }
  }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function drawWave(buf) {
    var c = $("#micWave"), d = window.devicePixelRatio || 1, W = Math.round(c.clientWidth * d), H = Math.round(c.clientHeight * d);
    if (!W) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    var g = c.getContext("2d"); g.clearRect(0, 0, W, H);
    g.strokeStyle = cssVar("--line-strong"); g.lineWidth = d; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    if (!buf) return;
    g.strokeStyle = cssVar("--accent"); g.lineWidth = 2 * d; g.beginPath();
    for (var x = 0; x < W; x++) { var v = buf[Math.floor(x / W * buf.length)]; var y = H / 2 - v * H * 0.45; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }
  function showLevel(db, pk) {
    $("#micLevel").style.width = dbToPct(db) + "%";
    var now = performance.now();
    if (pk > peakHold || now - peakT > 1500) { peakHold = pk; peakT = now; }
    $("#micPeak").style.left = dbToPct(peakHold) + "%";
    $("#micDb").textContent = (isFinite(db) ? db.toFixed(0) : "—") + " dB · peak " + (isFinite(peakHold) ? peakHold.toFixed(0) : "—") + " dB";
    recentMax.push(pk); if (recentMax.length > 90) recentMax.shift();
    var m = Math.max.apply(null, recentMax);
    $("#micHint").textContent = m > -1 ? "Clipping: lower the input volume" : m < -50 ? "Very quiet: is it muted?" : m < -30 ? "Quiet: speak up or move closer" : "Good level";
  }
  function micLoop() {
    if (!mic) return;
    mic.an.getFloatTimeDomainData(mic.buf);
    showLevel(rmsDb(mic.buf), peakDb(mic.buf));
    drawWave(mic.buf);
    requestAnimationFrame(micLoop);
  }
  $("#micStart").addEventListener("click", function () { if (mic) stopMic(); else startMic(); });
  $("#micDev").addEventListener("change", function () { if (mic) startMic(); });
  $("#micRec").addEventListener("click", function () {
    if (!mic) return;
    var btn = this, chunks = [], r;
    try { r = new MediaRecorder(mic.stream); } catch (e) { S3.toast("This browser can't record audio", "error"); return; }
    r.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
    r.onstop = function () {
      btn.disabled = !mic; btn.classList.remove("recording"); btn.lastChild.textContent = "Record 5 s & play back";
      var a = $("#micPlay"); if (a.src) URL.revokeObjectURL(a.src);
      a.src = URL.createObjectURL(new Blob(chunks, { type: r.mimeType || "audio/webm" })); a.hidden = false;
      a.play().catch(function () {});
    };
    r.start(); btn.disabled = true; btn.classList.add("recording");
    var left = 5; btn.lastChild.textContent = "Recording… " + left;
    var iv = setInterval(function () { left--; btn.lastChild.textContent = "Recording… " + left; if (left <= 0 || !mic) { clearInterval(iv); if (r.state !== "inactive") r.stop(); } }, 1000);
  });

  // ---------- speakers ----------
  var vol = (S3.store("devcheck.vol") || 40) / 100, sweepNode = null;
  $("#spkVol").value = Math.round(vol * 100); $("#spkVolV").textContent = Math.round(vol * 100) + "%";
  $("#spkVol").addEventListener("input", function () { vol = this.value / 100; $("#spkVolV").textContent = this.value + "%"; S3.store("devcheck.vol", +this.value); });
  $$(".spk .btn").forEach(function (b) {
    b.addEventListener("click", async function () {
      var ctx = await audioCtx();
      playChime(ctx, ctx.destination, +b.dataset.pan, ctx.currentTime + 0.03, vol);
      b.classList.add("on"); setTimeout(function () { b.classList.remove("on"); }, 1400);
      S3.done();
    });
  });
  $("#sweep").addEventListener("click", async function () {
    var ctx = await audioCtx(), btn = this;
    if (sweepNode) { sweepNode.stop(); return; }
    var o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + 0.03, dur = 8;
    o.frequency.setValueAtTime(20, t); o.frequency.exponentialRampToValueAtTime(20000, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.25, t + 0.1); g.gain.setValueAtTime(vol * 0.25, t + dur - 0.1); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur);
    sweepNode = o;
    o.onended = function () { sweepNode = null; btn.textContent = "Frequency sweep 20 Hz → 20 kHz (8 s)"; };
    (function tick() { if (sweepNode !== o) return; btn.textContent = "■ Stop · " + Math.round(sweepFreq(ctx.currentTime - t, dur)) + " Hz"; requestAnimationFrame(tick); })();
  });

  // ---------- screen ----------
  var hz = null;
  function mq(q) { return window.matchMedia && matchMedia(q).matches; }
  function screenInfo() {
    var d = window.devicePixelRatio || 1, s = window.screen;
    var gamut = mq("(color-gamut: rec2020)") ? "Rec. 2020" : mq("(color-gamut: p3)") ? "Display P3" : mq("(color-gamut: srgb)") ? "sRGB" : "—";
    $("#screenStats").innerHTML = "";
    [[s.width + "×" + s.height, "screen (CSS px)"], [Math.round(s.width * d) + "×" + Math.round(s.height * d), "physical pixels"], [+d.toFixed(2) + "×", "pixel ratio"], [hz ? hz + " Hz" : "…", "refresh rate"]]
      .forEach(function (x) { $("#screenStats").appendChild(S3.h("div", { "class": "stat" }, [S3.h("b", { text: x[0] }), S3.h("span", { text: x[1] })])); });
    kv($("#screenInfo"), [
      ["Aspect ratio", ratioName(s.width, s.height)], ["Available", s.availWidth + " × " + s.availHeight], ["Browser window", window.innerWidth + " × " + window.innerHeight],
      ["Colour depth", s.colorDepth + "-bit"], ["Colour gamut", gamut], ["HDR", mq("(dynamic-range: high)") ? "yes" : "no"],
      ["Orientation", s.orientation ? s.orientation.type.replace("-primary", "").replace("-secondary", " (flipped)") : ""],
      ["Touch points", navigator.maxTouchPoints || 0], ["Pointer", mq("(pointer: fine)") ? "fine (mouse/trackpad)" : mq("(pointer: coarse)") ? "coarse (touch)" : "none"],
      ["Theme preference", mq("(prefers-color-scheme: dark)") ? "dark" : "light"], ["Reduced motion", mq("(prefers-reduced-motion: reduce)") ? "on" : "off"]
    ]);
  }
  function measureHz() {
    hz = null; screenInfo();
    var last = 0, deltas = [], n = 0;
    requestAnimationFrame(function frame(t) {
      if (n++ > 10) deltas.push(t - last); // skip the first frames while the page settles
      last = t;
      if (deltas.length < 90) requestAnimationFrame(frame); else { hz = refreshHz(deltas); screenInfo(); }
    });
  }
  $("#hz").addEventListener("click", measureHz);
  window.addEventListener("resize", S3.debounce(screenInfo, 200));
  measureHz();

  // ---------- keyboard ----------
  var kb = $("#kb"), keyEls = {}, tested = {};
  LAYOUT.forEach(function (row) {
    var r = S3.h("div", { "class": "kb-row" });
    row.forEach(function (k) {
      var el = S3.h("span", { "class": "key", text: k[1] == null ? k[0] : k[1], "data-code": k[0] });
      el.style.setProperty("--w", k[2] || 1);
      keyEls[k[0]] = el; r.appendChild(el);
    });
    kb.appendChild(r);
  });
  function countTested() { var n = Object.keys(tested).length; $("#kbCount").textContent = n + (n === 1 ? " key" : " keys") + " tested"; }
  function otherKeys() { var o = Object.keys(tested).filter(function (c) { return !keyEls[c]; }); $("#kbOther").textContent = o.length ? "Also: " + o.slice(-6).join(", ") : ""; }
  function press(code, key, which, down) {
    var el = keyEls[code];
    if (down) { tested[code] = true; if (el) el.classList.add("down", "tested"); $("#kbKey").textContent = key === " " ? "Space" : key || "—"; $("#kbCode").textContent = code || "—"; $("#kbWhich").textContent = "keyCode " + which; countTested(); otherKeys(); }
    else if (el) el.classList.remove("down");
  }
  kb.addEventListener("focus", function () { kb.classList.add("active"); });
  kb.addEventListener("blur", function () { kb.classList.remove("active"); $$(".key.down").forEach(function (k) { k.classList.remove("down"); }); });
  kb.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && tested.Escape) { kb.blur(); return; } // second Escape leaves the tester
    e.preventDefault(); press(e.code, e.key, e.keyCode, true);
  });
  kb.addEventListener("keyup", function (e) { e.preventDefault(); if (e.code === "PrintScreen") press(e.code, e.key, e.keyCode, true); press(e.code, e.key, e.keyCode, false); });
  $("#kbReset").addEventListener("click", function () { tested = {}; $$(".key").forEach(function (k) { k.classList.remove("tested", "down"); }); countTested(); otherKeys(); ["#kbKey", "#kbCode", "#kbWhich"].forEach(function (s) { $(s).textContent = "—"; }); });
  window.addEventListener("pagehide", function () { stopCam(); stopMic(); });

  // ---------- demo + self-test ----------
  window.S3_DEMO = function () {
    "KeyS Digit3 KeyE KeyI KeyD KeyA KeyT Space ShiftLeft Enter".split(" ").forEach(function (c) { press(c, c.replace(/^Key|^Digit/, ""), 0, true); press(c, "", 0, false); });
    press("KeyT", "t", 84, true);
    kb.classList.add("active");
    var buf = new Float32Array(2048); for (var i = 0; i < 2048; i++) buf[i] = 0.35 * Math.sin(i / 9) * Math.sin(i / 300) + 0.08 * Math.sin(i / 2.3);
    chip($("#micStatus"), "● Live", "ok"); drawWave(buf); showLevel(-18, -9); $("#micHint").textContent = "Good level";
    kv($("#micInfo"), [["Device", "Built-in microphone"], ["Sample rate", "48000 Hz"], ["Channels", 1], ["Processing", "echo cancel, noise suppression, auto gain"]]);
    camMsg("Press Start camera to see a preview", true);
  };

  window.S3_SELFTEST = async function () {
    function deltas(ms, n, jitter) { var a = []; for (var i = 0; i < n; i++) a.push(ms + (i % 3 - 1) * jitter); return a; }
    var ok = refreshHz(deltas(16.667, 60, 0.4)) === 60 && refreshHz(deltas(6.944, 60, 0.2)) === 144 && refreshHz(deltas(8.333, 60, 0.3)) === 120 &&
      refreshHz(deltas(1000 / 57, 60, 0)) === 57 && refreshHz([]) === null;
    ok = ok && ratioName(1920, 1080) === "16:9" && ratioName(2560, 1600) === "16:10" && ratioName(1280, 1024) === "5:4" && ratioName(3440, 1440) === "21:9" && ratioName(1000, 700) === "10:7";
    ok = ok && Math.abs(rmsDb(new Float32Array(100).fill(0.5)) + 6.0206) < 1e-3 && rmsDb(new Float32Array(10)) === -Infinity && Math.abs(peakDb(new Float32Array([0.1, -1])) - 0) < 1e-9;
    ok = ok && dbToPct(0) === 100 && dbToPct(-60) === 0 && dbToPct(-30) === 50 && dbToPct(-Infinity) === 0;
    ok = ok && sweepFreq(0, 8) === 20 && Math.abs(sweepFreq(8, 8) - 20000) < 1e-6 && Math.abs(sweepFreq(4, 8) - 632.456) < 0.01;
    var codes = [].concat.apply([], LAYOUT.map(function (r) { return r.map(function (k) { return k[0]; }); }));
    ok = ok && codes.length === new Set(codes).size && codes.indexOf("KeyA") >= 0 && codes.indexOf("Space") >= 0 && codes.length === 77;
    // left chime must come out of the left channel only, right only right
    async function render(pan) {
      var off = new OfflineAudioContext(2, 22050, 22050); playChime(off, off.destination, pan, 0, 1);
      var b = await off.startRendering(), e = [0, 0];
      for (var c = 0; c < 2; c++) { var x = b.getChannelData(c); for (var i = 0; i < x.length; i++) e[c] += x[i] * x[i]; }
      return e;
    }
    var L = await render(-1), R = await render(1), C = await render(0);
    ok = ok && L[0] > 10 && L[1] < 1e-6 && R[1] > 10 && R[0] < 1e-6 && Math.abs(C[0] - C[1]) / C[0] < 1e-3;
    return ok;
  };
})();
