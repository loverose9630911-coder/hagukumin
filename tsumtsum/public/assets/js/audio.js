/* =========================================================
 *  ぞうさんとなかまたち ― 音
 *
 *  音源ファイルは持たず、WebAudio でその場で合成する。
 *  ブラウザの制限で、最初のタップまで音は鳴らせないので
 *  Sound.resume() を最初の操作で呼ぶこと。
 * =======================================================*/

var Sound = (function () {
  'use strict';

  var KEY = 'zousan_sound';
  var ctx = null, master = null, bgmGain = null;
  var bgmTimer = null, bgmStep = 0, bgmFast = false;
  var enabled = true;

  try {
    enabled = localStorage.getItem(KEY) !== 'off';
  } catch (e) { /* localStorage が使えなくても続行 */ }

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
    bgmGain = ctx.createGain();
    bgmGain.gain.value = 0.14;
    bgmGain.connect(master);
    return ctx;
  }

  function resume() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function on() { return enabled && ensure() !== null; }

  function setEnabled(value) {
    enabled = !!value;
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch (e) { /* 無視 */ }
    if (!enabled) bgmStop();
    else { resume(); bgmStart(bgmFast); }
    return enabled;
  }

  function isEnabled() { return enabled; }

  /* ---------------------------------------------------------- 音のもと */

  function tone(freq, dur, type, vol, delay, glideTo) {
    if (!on()) return;
    var t0 = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.25, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, cutoff, delay) {
    if (!on()) return;
    var t0 = ctx.currentTime + (delay || 0);
    var length = Math.floor(ctx.sampleRate * dur);
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff || 1200;
    var gain = ctx.createGain();
    gain.gain.value = vol || 0.3;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t0);
  }

  /* ---------------------------------------------------------- 効果音 */

  // つなぐたびに音階が上がっていく
  var SCALE = [523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77,
    1046.5, 1174.7, 1318.5, 1396.9, 1568.0];

  function chainTick(index) {
    tone(SCALE[Math.min(index, SCALE.length - 1)], 0.10, 'triangle', 0.20);
  }

  function pop(count) {
    var n = Math.min(count || 3, 10);
    for (var i = 0; i < 3; i++) {
      tone(420 + n * 40 + i * 120, 0.16, 'sine', 0.18, i * 0.03);
    }
    noise(0.14, 0.16, 2400);
  }

  function bomb() {
    noise(0.45, 0.5, 700);
    tone(150, 0.4, 'sawtooth', 0.28, 0, 40);
  }

  function skill() {
    for (var i = 0; i < 6; i++) {
      tone(392 * Math.pow(2, i / 6), 0.28, 'triangle', 0.16, i * 0.045);
    }
    noise(0.5, 0.18, 3000);
  }

  function fever() {
    [523, 659, 784, 1046].forEach(function (f, i) {
      tone(f, 0.35, 'square', 0.13, i * 0.09);
    });
  }

  function countdown(isLast) {
    tone(isLast ? 1046 : 660, isLast ? 0.4 : 0.14, 'square', 0.18);
  }

  function finish() {
    [784, 880, 1046, 1318].forEach(function (f, i) {
      tone(f, 0.5, 'triangle', 0.2, i * 0.13);
    });
  }

  function ng() { tone(220, 0.14, 'sine', 0.14, 0, 160); }

  function ui() { tone(880, 0.07, 'triangle', 0.16); }

  /* ---------------------------------------------------------- BGM */

  var PROGRESSION = [
    [0, 4, 7, 11], [-3, 2, 5, 9], [-5, 0, 4, 7], [-1, 2, 7, 11]
  ];

  function bgmNote() {
    if (!on()) return;
    var bar = Math.floor(bgmStep / 8) % PROGRESSION.length;
    var chord = PROGRESSION[bar];
    var semi = chord[bgmStep % 4] + (bgmStep % 8 >= 4 ? 12 : 0);
    var t0 = ctx.currentTime;

    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 261.63 * Math.pow(2, semi / 12);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.34);
    osc.connect(gain);
    gain.connect(bgmGain);
    osc.start(t0);
    osc.stop(t0 + 0.4);

    if (bgmStep % 4 === 0) {
      var bass = ctx.createOscillator();
      var bassGain = ctx.createGain();
      bass.type = 'sine';
      bass.frequency.value = 261.63 * Math.pow(2, (chord[0] - 12) / 12);
      bassGain.gain.setValueAtTime(0.0001, t0);
      bassGain.gain.exponentialRampToValueAtTime(0.7, t0 + 0.03);
      bassGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      bass.connect(bassGain);
      bassGain.connect(bgmGain);
      bass.start(t0);
      bass.stop(t0 + 0.7);
    }
    bgmStep++;
  }

  function bgmStart(fast) {
    bgmFast = !!fast;
    bgmStop();
    if (!on()) return;
    bgmTimer = setInterval(bgmNote, bgmFast ? 150 : 200);
  }

  function bgmStop() {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
  }

  /** フィーバー中は速くする */
  function bgmRate(fast) {
    if (!bgmTimer) return;
    if (bgmFast === !!fast) return;
    bgmStart(fast);
  }

  return {
    resume: resume, setEnabled: setEnabled, isEnabled: isEnabled,
    chainTick: chainTick, pop: pop, bomb: bomb, skill: skill, fever: fever,
    countdown: countdown, finish: finish, ng: ng, ui: ui,
    bgmStart: bgmStart, bgmStop: bgmStop, bgmRate: bgmRate
  };
})();
