// Every sound is synthesized with WebAudio: filtered noise and oscillators,
// no audio assets. The mixer is one master gain; distance attenuates each
// one-shot against the listener, and the bomb beep is the only loop.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  const listener = { x: 0, y: 0, z: 0 };

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.45;
      master.connect(ctx.destination);
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      return false;
    }
    return true;
  }

  function noise(dur, filterType, freq, gain, when) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = freq;
    const g = ctx.createGain();
    const t = when ?? ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, gain, type, slideTo, when) {
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    const t = when ?? ctx.currentTime;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function attenuate(pos) {
    if (!pos) return 1;
    const dx = pos.x - listener.x;
    const dy = pos.y - listener.y;
    const dz = pos.z - listener.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return Math.max(0, 1 - d / 42);
  }

  const players = {
    shot(pos, kind) {
      const v = attenuate(pos);
      if (v <= 0.02) return;
      noise(0.14, 'lowpass', kind === 'marksman' ? 900 : 1600, 0.9 * v);
      tone(kind === 'marksman' ? 120 : 170, 0.09, 0.5 * v, 'triangle', 55);
    },
    dry() {
      tone(1400, 0.03, 0.12, 'square');
    },
    reload() {
      tone(700, 0.04, 0.16, 'square');
      tone(520, 0.05, 0.16, 'square', null, ctx.currentTime + 0.28);
      tone(900, 0.05, 0.2, 'square', null, ctx.currentTime + 0.55);
    },
    hit() {
      tone(2100, 0.045, 0.22, 'sine');
    },
    kill() {
      tone(880, 0.07, 0.2, 'sine');
      tone(1320, 0.1, 0.2, 'sine', null, ctx.currentTime + 0.07);
    },
    hurt() {
      tone(110, 0.12, 0.4, 'sine', 60);
    },
    beep(rate) {
      tone(1560, 0.06, 0.22, 'square');
      void rate;
    },
    explosion(pos) {
      const v = attenuate(pos);
      if (v <= 0.02) return;
      noise(0.9, 'lowpass', 300, 1.1 * v);
      tone(70, 0.7, 0.8 * v, 'sine', 28);
    },
    plant() {
      tone(520, 0.09, 0.2, 'sine');
      tone(780, 0.12, 0.2, 'sine', null, ctx.currentTime + 0.1);
    },
    defuse() {
      tone(780, 0.09, 0.2, 'sine');
      tone(1040, 0.14, 0.2, 'sine', null, ctx.currentTime + 0.1);
    },
    roundWin() {
      tone(523, 0.12, 0.22, 'triangle');
      tone(659, 0.12, 0.22, 'triangle', null, ctx.currentTime + 0.12);
      tone(784, 0.2, 0.24, 'triangle', null, ctx.currentTime + 0.24);
    },
    roundLose() {
      tone(392, 0.14, 0.2, 'triangle');
      tone(330, 0.14, 0.2, 'triangle', null, ctx.currentTime + 0.14);
      tone(262, 0.24, 0.2, 'triangle', null, ctx.currentTime + 0.28);
    },
    buy() {
      tone(1180, 0.06, 0.18, 'sine');
      tone(1560, 0.09, 0.18, 'sine', null, ctx.currentTime + 0.06);
    },
    step(pos) {
      const v = attenuate(pos);
      if (v <= 0.05) return;
      noise(0.05, 'lowpass', 500, 0.14 * v);
    },
    bounce(pos) {
      const v = attenuate(pos);
      if (v <= 0.05) return;
      tone(340, 0.05, 0.2 * v, 'triangle');
    },
    smoke(pos) {
      const v = attenuate(pos);
      if (v <= 0.05) return;
      noise(0.7, 'bandpass', 1200, 0.25 * v);
    },
    throwIt() {
      noise(0.08, 'bandpass', 900, 0.14);
    },
  };

  return {
    resume() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    setListener(x, y, z) {
      listener.x = x;
      listener.y = y;
      listener.z = z;
    },
    play(name, pos, arg) {
      if (!ensure()) return;
      const fn = players[name];
      if (fn) fn(pos, arg);
    },
  };
}
