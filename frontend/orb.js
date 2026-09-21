/* ============================================================
   orb.js  -  StudyFlow's 3D engine (raw WebGL, zero dependencies)

   Exposes window.SFOrb:
     SFOrb.orb(canvas, opts)      -> the glowing "Flow Orb" (a shader-drawn glass sphere)
     SFOrb.backdrop(canvas)       -> the drifting nebula + starfield behind the whole app
     SFOrb.setMouse(x, y)         -> -1..1 pointer position (gives everything parallax)
     SFOrb.supported              -> false when WebGL is unavailable (CSS fallbacks show)

   Everything renders in a single requestAnimationFrame loop, pauses when the tab is
   hidden or the canvas is off-screen, and lowers its own resolution if the GPU is slow.
   ============================================================ */
(function () {
  "use strict";

  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- shared GLSL ----------
  const VERT = "attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }";

  const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2  uRes;
uniform float uTime;
uniform vec2  uMouse;
uniform vec3  uA;
uniform vec3  uB;
uniform vec3  uC;
uniform float uEnergy;
uniform float uBreath;
uniform float uLight;

float hash(vec3 p){
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x){
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0.0,0.0,0.0)), hash(i + vec3(1.0,0.0,0.0)), f.x),
                 mix(hash(i + vec3(0.0,1.0,0.0)), hash(i + vec3(1.0,1.0,0.0)), f.x), f.y),
             mix(mix(hash(i + vec3(0.0,0.0,1.0)), hash(i + vec3(1.0,0.0,1.0)), f.x),
                 mix(hash(i + vec3(0.0,1.0,1.0)), hash(i + vec3(1.0,1.0,1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p){
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p = p * 2.02 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

  // ---------- the orb ----------
  const ORB_FRAG = HEAD + `
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y) * 2.0;
  float R = 0.64 + 0.018 * uBreath;
  float d = length(uv);
  vec2 q = uv / R;
  float r2 = dot(q, q);
  float rq = sqrt(r2);
  float px = 2.0 / (min(uRes.x, uRes.y) * R);
  float mask = 1.0 - smoothstep(1.0 - px * 1.6, 1.0, rq);

  vec3 n = vec3(q, sqrt(max(0.0, 1.0 - r2)));

  // rotate the sample point: slow spin + pointer tilt
  float yaw = uTime * (0.10 + 0.22 * uEnergy) + uMouse.x * 0.55;
  float pit = uMouse.y * 0.35 + 0.25;
  float cy = cos(yaw), sy = sin(yaw), cp = cos(pit), sp = sin(pit);
  vec3 p = vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z);
  p = vec3(p.x, cp * p.y - sp * p.z, sp * p.y + cp * p.z);

  float t = uTime * (0.22 + 0.55 * uEnergy);
  vec3 w = vec3(fbm(p * 1.5 + t * 0.6),
                fbm(p * 1.5 + 7.3 - t * 0.5),
                fbm(p * 1.5 + 3.1 + t * 0.4));
  float f = fbm(p * 2.1 + w * 1.9 + vec3(0.0, t, 0.0));
  float g = fbm(p * 3.2 - w * 1.3 + t * 0.3);

  float fc = smoothstep(0.22, 0.78, f);
  vec3 c = mix(uA, uB, fc);
  c = mix(c, uC, smoothstep(0.40, 0.85, g) * 0.9);

  // glass depth: calm, darker centre (so the digits read) and a lit rim
  float rim = pow(1.0 - n.z, 1.25);
  vec3 col = c * (0.22 + 0.10 * uLight + 1.05 * rim);

  // luminous plasma filaments
  float fil = pow(1.0 - abs(sin(f * 5.5 + g * 2.2 + t * 1.1)), 3.5);
  col += mix(uB, uC, g) * fil * (0.20 + 0.62 * rim + 0.14 * uEnergy);
  col += c * fc * (0.16 + 0.55 * rim);
  col *= 0.7 + 0.3 * smoothstep(0.0, 0.85, 1.0 - n.z);

  // thin-film iridescence on the edge
  vec3 irid = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + n.z * 1.25 + uTime * 0.04));
  float fr = pow(1.0 - n.z, 3.0);
  col += mix(uC, irid, 0.65) * fr * (1.05 + 0.7 * uEnergy);

  // glassy specular highlights
  vec3 L = normalize(vec3(-0.55, 0.62, 0.62));
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 42.0);
  col += vec3(1.0) * spec * 0.85;
  col += vec3(1.0) * smoothstep(0.72, 1.0, dot(n, L)) * 0.10;

  // halo around the sphere
  float ang = atan(uv.y, uv.x);
  vec3 gc = mix(uA, uB, 0.5 + 0.5 * sin(ang * 2.0 + uTime * 0.35));
  float ga = exp(-max(d - R, 0.0) * 4.6) * (0.30 + 0.30 * uEnergy);
  ga *= mix(1.0, 0.75, uLight);
  ga *= 1.0 - mask;
  ga *= smoothstep(1.0, 0.70, d);                              // fade to nothing before the canvas edge

  vec3 rgb = col * mask + gc * ga;
  float a = mask + ga * (1.0 - mask);
  rgb += (hash(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0 * a;   // de-band
  gl_FragColor = vec4(rgb, a);
}`;

  // ---------- the nebula backdrop ----------
  const BG_FRAG = HEAD + `
float stars(vec2 p, float scale, float seed){
  vec2 g = p * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(id + seed);
  vec2 off = vec2(hash21(id + seed + 3.1), hash21(id + seed + 7.7)) - 0.5;
  float dd = length(f - off * 0.7);
  float tw = 0.65 + 0.35 * sin(uTime * (0.8 + h * 2.5) + h * 40.0);
  float s = smoothstep(0.05 + h * 0.035, 0.0, dd) * step(0.86, h) * tw;
  return s * (0.5 + 0.9 * h);
}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec2 m = uMouse * 0.035;
  float t = uTime * 0.035;
  float n1 = fbm(vec3((p + m) * 1.25, t));
  float n2 = fbm(vec3((p - m) * 2.3 + 5.0, t * 1.4 + 3.0));
  vec3 col = vec3(0.050, 0.035, 0.100);
  col += uA * pow(n1, 2.3) * 0.85;
  col += uB * pow(n2, 2.9) * 0.55;
  col *= 1.0 - dot(uv - 0.5, uv - 0.5) * 0.95;               // vignette
  float st = stars(p + m * 0.6 + vec2(t * 0.6, 0.0), 34.0, 1.0)
           + stars(p + m * 1.4 + vec2(t * 1.2, 0.0), 19.0, 9.0) * 0.9;
  col += vec3(0.85, 0.88, 1.0) * st * 0.85;
  gl_FragColor = vec4(col, 1.0);
}`;

  // ---------- helpers ----------
  const hex = (h) => {
    const s = h.replace("#", "");
    const v = parseInt(s.length === 3 ? s.replace(/./g, "$&$&") : s, 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  };
  const lerp = (a, b, k) => a + (b - a) * k;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("SFOrb shader error:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function makeProgram(canvas, frag, opts) {
    let gl = null;
    try {
      gl = canvas.getContext("webgl", Object.assign({ alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: "low-power" }, opts || {})) ||
           canvas.getContext("experimental-webgl");
    } catch (e) { gl = null; }
    if (!gl) return null;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("SFOrb link error:", gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const u = {};
    ["uRes", "uTime", "uMouse", "uA", "uB", "uC", "uEnergy", "uBreath", "uLight"].forEach((n) => {
      u[n] = gl.getUniformLocation(prog, n);
    });
    return { gl, prog, u };
  }

  // ---------- render loop ----------
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  const items = new Set();
  let raf = 0;
  let lastNow = 0;

  function loop(now) {
    raf = 0;
    const dt = Math.min(0.1, (now - lastNow) / 1000 || 0.016);
    lastNow = now;
    mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 4);
    mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 4);

    let any = false;
    items.forEach((it) => {
      if (!it.active) return;
      any = true;
      if (now - it.lastDraw < it.minDt) return;
      it.draw(now, (now - it.lastDraw) / 1000);
      it.lastDraw = now;
    });
    if (any && !document.hidden) raf = requestAnimationFrame(loop);
  }
  function kick() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(loop);
  }
  document.addEventListener("visibilitychange", kick);

  // ---------- generic item ----------
  function makeItem(canvas, frag, cfg) {
    const ctx = makeProgram(canvas, frag);
    if (!ctx) return null;
    const { gl, u } = ctx;

    const it = {
      canvas,
      active: false,
      visible: false,
      enabled: true,
      lastDraw: 0,
      minDt: 0,
      scale: cfg.scale,
      maxDpr: cfg.maxDpr,
      light: 0,
      tA: hex("#7f6bff"), tB: hex("#ff7ad1"), tC: hex("#4fe3ff"),
      cA: null, cB: null, cC: null,
      tEnergy: 0, cEnergy: 0,
      time: Math.random() * 50,
      slowFrames: 0,
      frames: 0,
      lite: false
    };
    it.cA = it.tA.slice(); it.cB = it.tB.slice(); it.cC = it.tC.slice();

    it.refreshActive = () => { it.active = it.visible && it.enabled && !canvas.hidden; kick(); };

    it.resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, it.maxDpr);
      const w = Math.max(2, Math.round(canvas.clientWidth * dpr * it.scale));
      const h = Math.max(2, Math.round(canvas.clientHeight * dpr * it.scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    it.draw = (now, dtSec) => {
      it.resize();
      const dt = Math.min(0.1, dtSec || 0.016);
      const speed = reduceMotion ? 0.15 : 1;
      it.time += dt * speed * (it.lite ? 0.7 : 1);

      const k = Math.min(1, dt * 3.2);
      for (let i = 0; i < 3; i++) {
        it.cA[i] = lerp(it.cA[i], it.tA[i], k);
        it.cB[i] = lerp(it.cB[i], it.tB[i], k);
        it.cC[i] = lerp(it.cC[i], it.tC[i], k);
      }
      it.cEnergy = lerp(it.cEnergy, it.tEnergy, k);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform1f(u.uTime, it.time);
      gl.uniform2f(u.uMouse, mouse.sx, mouse.sy);
      gl.uniform3fv(u.uA, it.cA);
      gl.uniform3fv(u.uB, it.cB);
      gl.uniform3fv(u.uC, it.cC);
      gl.uniform1f(u.uEnergy, it.cEnergy);
      gl.uniform1f(u.uBreath, Math.sin(it.time * (1.1 + it.cEnergy * 1.5)));
      gl.uniform1f(u.uLight, it.light);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // adaptive quality: if frames take too long, render fewer pixels
      it.frames++;
      const gap = dtSec * 1000;
      if (it.frames > 20 && gap > 38 && !it.lite) {
        if (++it.slowFrames > 25 && it.scale > 0.45) { it.scale *= 0.8; it.slowFrames = 0; }
      } else if (gap < 30) {
        it.slowFrames = Math.max(0, it.slowFrames - 1);
      }
    };

    // pause when off-screen
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((e) => { it.visible = e.isIntersecting; });
        it.refreshActive();
      }).observe(canvas);
    } else {
      it.visible = true;
    }

    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); it.enabled = false; it.refreshActive(); });
    canvas.addEventListener("webglcontextrestored", () => { it.enabled = true; it.refreshActive(); });

    it.setPalette = (a, b, c) => { it.tA = hex(a); it.tB = hex(b); it.tC = hex(c || b); kick(); };
    it.snapPalette = () => { it.cA = it.tA.slice(); it.cB = it.tB.slice(); it.cC = it.tC.slice(); };
    it.setEnergy = (v) => { it.tEnergy = v; kick(); };
    it.setLight = (on) => { it.light = on ? 1 : 0; };
    it.setEnabled = (on) => { it.enabled = !!on; it.refreshActive(); };
    it.setLite = (on) => {
      it.lite = !!on;
      it.minDt = on ? 1000 / 20 : 0;
      it.scale = on ? cfg.scale * 0.6 : cfg.scale;
    };

    items.add(it);
    return it;
  }

  // ---------- public API ----------
  const probe = document.createElement("canvas");
  const supported = !!(probe.getContext && (probe.getContext("webgl") || probe.getContext("experimental-webgl")));

  window.SFOrb = {
    supported,
    setMouse(x, y) { mouse.x = x; mouse.y = y; kick(); },
    orb(canvas, opts) {
      if (!supported || !canvas) return null;
      const it = makeItem(canvas, ORB_FRAG, { scale: 1, maxDpr: 1.6 });
      if (it && opts && opts.palette) it.setPalette.apply(null, opts.palette);
      if (it) it.snapPalette();
      return it;
    },
    backdrop(canvas) {
      if (!supported || !canvas) return null;
      // the nebula is soft, so render it at ~55% resolution and let CSS stretch it
      const it = makeItem(canvas, BG_FRAG, { scale: 0.75, maxDpr: 1 });
      if (it) it.minDt = 1000 / 30;
      return it;
    }
  };
})();