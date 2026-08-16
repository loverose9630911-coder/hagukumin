/* =========================================================
 *  ハグミン ツムツム  ―  効果音 / BGM（WebAudio で合成）
 *  音源ファイル不要。すべてその場で生成する。
 * =======================================================*/

var Sound = (function () {

  var ctx = null, master = null, bgmGain = null, bgmTimer = null, bgmStep = 0;

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.16;
    bgmGain.connect(master);
    return ctx;
  }

  function resume() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, dur, type, vol, when, glideTo) {
    if (!ensure() || !Save.data.se) return;
    var t0 = ctx.currentTime + (when || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, when, freq) {
    if (!ensure() || !Save.data.se) return;
    var t0 = ctx.currentTime + (when || 0);
    var len = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 1200;
    var g = ctx.createGain(); g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  /* ---- 効果音 ---- */
  var SCALE = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77, 1046.5, 1174.7, 1318.5, 1396.9, 1568.0];

  function chainTick(n) {
    tone(SCALE[Math.min(n, SCALE.length - 1)], 0.10, 'triangle', 0.20);
  }
  function pop(count) {
    var c = Math.min(count, 10);
    for (var i = 0; i < 3; i++) {
      tone(420 + c * 40 + i * 120, 0.16, 'sine', 0.18, i * 0.03);
    }
    noise(0.14, 0.16, 0, 2400);
  }
  function bomb() {
    noise(0.45, 0.5, 0, 700);
    tone(150, 0.4, 'sawtooth', 0.28, 0, 40);
  }
  function skill() {
    for (var i = 0; i < 6; i++) tone(392 * Math.pow(2, i / 6), 0.28, 'triangle', 0.16, i * 0.045);
    noise(0.5, 0.18, 0, 3000);
  }
  function fever() {
    [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.35, 'square', 0.13, i * 0.09); });
  }
  function ui() { tone(880, 0.07, 'triangle', 0.16); }
  function ng() { tone(220, 0.14, 'sine', 0.14, 0, 160); }
  function countdown(last) {
    tone(last ? 1046 : 660, last ? 0.4 : 0.14, 'square', 0.18);
  }
  function finish() {
    [784, 880, 1046, 1318].forEach(function (f, i) { tone(f, 0.5, 'triangle', 0.2, i * 0.13); });
  }

  /* ---- BGM（軽いアルペジオ） ---- */
  var PROG = [
    [0, 4, 7, 11], [-3, 2, 5, 9], [-5, 0, 4, 7], [-1, 2, 7, 11]
  ];

  function bgmNote() {
    if (!ctx || !Save.data.bgm) return;
    var bar = Math.floor(bgmStep / 8) % PROG.length;
    var chord = PROG[bar];
    var semi = chord[bgmStep % 4] + (bgmStep % 8 >= 4 ? 12 : 0);
    var f = 261.63 * Math.pow(2, semi / 12);
    var t0 = ctx.currentTime;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    o.connect(g); g.connect(bgmGain);
    o.start(t0); o.stop(t0 + 0.4);

    if (bgmStep % 4 === 0) {
      var bo = ctx.createOscillator(), bg = ctx.createGain();
      bo.type = 'sine';
      bo.frequency.value = 261.63 * Math.pow(2, (chord[0] - 12) / 12);
      bg.gain.setValueAtTime(0.0001, t0);
      bg.gain.exponentialRampToValueAtTime(0.7, t0 + 0.03);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      bo.connect(bg); bg.connect(bgmGain);
      bo.start(t0); bo.stop(t0 + 0.7);
    }
    bgmStep++;
  }

  function bgmStart(fast) {
    ensure();
    bgmStop();
    if (!Save.data.bgm) return;
    bgmStep = 0;
    bgmTimer = setInterval(bgmNote, fast ? 150 : 200);
  }
  function bgmStop() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }
  function bgmRate(fast) {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = setInterval(bgmNote, fast ? 150 : 200); }
  }

  return {
    resume: resume, chainTick: chainTick, pop: pop, bomb: bomb, skill: skill,
    fever: fever, ui: ui, ng: ng, countdown: countdown, finish: finish,
    bgmStart: bgmStart, bgmStop: bgmStop, bgmRate: bgmRate
  };
})();
