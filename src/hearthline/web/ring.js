// Ring and call-progress tones made with Web Audio, so there are no files to load.
const Tones = (() => {
  let ctx = null;
  let timer = null;

  function unlock() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  }

  // Plays the given frequencies for `burst` seconds, every `period` seconds.
  function pattern(freqs, burst, period, volume) {
    stop();
    if (!ctx) return;
    const play = () => {
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      for (const f of freqs) {
        const osc = ctx.createOscillator();
        osc.frequency.value = f;
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + burst);
      }
    };
    play();
    timer = setInterval(play, period * 1000);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    unlock,
    stop,
    ring: () => pattern([800, 1000], 1.5, 4, 0.06),
    ringback: () => pattern([425], 1, 5, 0.05),
    busy: () => pattern([425], 0.5, 1, 0.05),
  };
})();
