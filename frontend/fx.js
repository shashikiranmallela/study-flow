/* ============================================================
   fx.js  -  sound, confetti and 3D card tilt
   Exposes window.SFX = { Sound, Confetti, tilt }
   No audio files are needed: rain / ocean / deep-noise are generated live
   with the Web Audio API.
   ============================================================ */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------
  // SOUND
  // ------------------------------------------------------------
  const Sound = (function () {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null;
    let master = null;
    let bed = null;
    let kind = "off";
    let volume = 0.5;
    const cache = {};

    function ensure() {
      if (!AC) return false;
      if (!ctx) {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = volume * 0.9;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return true;
    }

    function noiseBuffer(type) {
      if (cache[type]) return cache[type];
      const len = ctx.sampleRate * 6;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === "brown") {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else if (type === "pink") {
          b0 = 0.99765 * b0 + w * 0.099046;
          b1 = 0.963 * b1 + w * 0.2965164;
          b2 = 0.57 * b2 + w * 1.0526913;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
        } else {
          d[i] = w * 0.6;
        }
      }
      cache[type] = buf;
      return buf;
    }

    function noiseSource(type) {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuffer(type);
      s.loop = true;
      s.start();
      return s;
    }

    function filter(type, freq, q) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (q) f.Q.value = q;
      return f;
    }

    function gain(v) {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    }

    function lfo(rate, depth, target) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = rate;
      g.gain.value = depth;
      o.connect(g);
      g.connect(target);
      o.start();
      return o;
    }

    // Each bed returns { out, nodes } - out is a GainNode we fade in/out.
    function buildBed(name) {
      const out = ctx.createGain();
      out.gain.value = 0;
      const nodes = [];

      if (name === "rain") {
        const a = noiseSource("white");
        const hp = filter("highpass", 900);
        const lp = filter("lowpass", 9000);
        const ga = gain(0.42);
        a.connect(hp); hp.connect(lp); lp.connect(ga); ga.connect(out);
        const b = noiseSource("pink");
        const lp2 = filter("lowpass", 420);
        const gb = gain(0.55);
        b.connect(lp2); lp2.connect(gb); gb.connect(out);
        nodes.push(a, b, lfo(0.23, 0.05, ga.gain));
      } else if (name === "ocean") {
        const a = noiseSource("pink");
        const lp = filter("lowpass", 700, 0.7);
        const ga = gain(0.7);
        a.connect(lp); lp.connect(ga); ga.connect(out);
        nodes.push(a, lfo(0.085, 520, lp.frequency), lfo(0.085, 0.32, ga.gain));
        const b = noiseSource("white");
        const hp = filter("highpass", 3200);
        const gb = gain(0.05);
        b.connect(hp); hp.connect(gb); gb.connect(out);
        nodes.push(b, lfo(0.085, 0.045, gb.gain));
      } else {
        const a = noiseSource("brown");
        const lp = filter("lowpass", 950);
        const ga = gain(1.1);
        a.connect(lp); lp.connect(ga); ga.connect(out);
        nodes.push(a);
      }
      out.connect(master);
      return { out, nodes };
    }

    function stopBed(b) {
      if (!b) return;
      const t = ctx.currentTime;
      b.out.gain.cancelScheduledValues(t);
      b.out.gain.setTargetAtTime(0, t, 0.15);
      setTimeout(() => {
        b.nodes.forEach((n) => { try { n.stop(); } catch (e) { /* already stopped */ } });
        try { b.out.disconnect(); } catch (e) { /* ignore */ }
      }, 900);
    }

    return {
      get kind() { return kind; },
      set(name) {
        if (name === kind) return kind;
        if (name === "off") {
          if (ctx) stopBed(bed);
          bed = null;
          kind = "off";
          return kind;
        }
        if (!ensure()) return kind;
        stopBed(bed);
        bed = buildBed(name);
        bed.out.gain.setTargetAtTime(1, ctx.currentTime, 0.35);
        kind = name;
        return kind;
      },
      setVolume(v) {
        volume = Math.max(0, Math.min(1, v));
        if (master) master.gain.setTargetAtTime(volume * 0.9, ctx.currentTime, 0.05);
      },
      chime() {
        if (!ensure()) return;
        const t = ctx.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const s = t + i * 0.16;
          o.type = "sine";
          o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, s);
          g.gain.linearRampToValueAtTime(0.2, s + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, s + 1.1);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(s);
          o.stop(s + 1.2);
        });
      }
    };
  })();

  // ------------------------------------------------------------
  // CONFETTI
  // ------------------------------------------------------------
  const Confetti = (function () {
    let cv = null;
    let cx = null;
    let parts = [];
    let raf = 0;

    function size() {
      const d = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = window.innerWidth * d;
      cv.height = window.innerHeight * d;
      cx.setTransform(d, 0, 0, d, 0, 0);
    }
    function init() {
      cv = document.getElementById("fxCanvas");
      if (!cv) return false;
      cx = cv.getContext("2d");
      size();
      window.addEventListener("resize", size);
      return true;
    }
    function tick() {
      cx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      parts = parts.filter((p) => p.life < p.max);
      parts.forEach((p) => {
        p.life++;
        p.vy += p.g;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        cx.save();
        cx.globalAlpha = Math.max(0, 1 - p.life / p.max);
        cx.translate(p.x, p.y);
        cx.rotate(p.rot);
        cx.fillStyle = p.c;
        cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        cx.restore();
      });
      if (parts.length) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
        cx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }

    return {
      burst(x, y, count, opt) {
        if (reduceMotion) return;
        if (!cv && !init()) return;
        opt = opt || {};
        const colors = opt.colors || ["#9b8cff", "#5be7ff", "#ff7ac0", "#ffc14d", "#5be3a8"];
        const n = count || 90;
        for (let i = 0; i < n; i++) {
          parts.push({
            x: x, y: y,
            vx: (Math.random() - 0.5) * (opt.spread || 15),
            vy: -(Math.random() * (opt.up || 13) + 4),
            g: 0.38,
            w: 6 + Math.random() * 6,
            h: 4 + Math.random() * 5,
            rot: Math.random() * 6.28,
            vr: (Math.random() - 0.5) * 0.4,
            c: colors[i % colors.length],
            life: 0,
            max: 70 + Math.random() * 50
          });
        }
        if (!raf) raf = requestAnimationFrame(tick);
      }
    };
  })();

  // ------------------------------------------------------------
  // 3D TILT  (cards lean toward the pointer and catch a moving highlight)
  // ------------------------------------------------------------
  function tilt(root) {
    if (reduceMotion) return;
    if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;
    (root || document).querySelectorAll("[data-tilt]").forEach((el) => {
      if (el.__tilt) return;
      el.__tilt = true;
      el.addEventListener("pointermove", (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        el.style.setProperty("--ry", ((px - 0.5) * 7).toFixed(2) + "deg");
        el.style.setProperty("--rx", ((0.5 - py) * 7).toFixed(2) + "deg");
        el.style.setProperty("--mx", (px * 100).toFixed(1) + "%");
        el.style.setProperty("--my", (py * 100).toFixed(1) + "%");
        el.style.setProperty("--gl", "1");
      });
      el.addEventListener("pointerleave", () => {
        el.style.setProperty("--rx", "0deg");
        el.style.setProperty("--ry", "0deg");
        el.style.setProperty("--gl", "0");
      });
    });
  }

  window.SFX = { Sound: Sound, Confetti: Confetti, tilt: tilt };
})();