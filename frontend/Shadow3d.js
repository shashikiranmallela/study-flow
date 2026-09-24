/* ============================================================
   shadow3d.js  -  StudyFlow's real-3D shadow warrior (Three.js r128)

   What it does
   1. UMBRA: an original 3D warrior that walks after your cursor on every page,
      looks at you, and fights back when you click:
        click         shadow-step + slash where you clicked (3 quick clicks = finisher)
        double-click  ARISE: three shadow soldiers rise from the ground
        click Umbra   he reacts
        timer running he takes a guard post in the corner and stops chasing you
   2. YOUR ARMY: every shadow you have extracted follows Umbra in formation.
   3. Replaces the flat 2D figures in the System page, ARISE cinematic and
      gate bosses with real 3D ones (via Shadow3D.figure, see the 1-line hook).
   All art and names are original. Needs three.js r128 loaded first.
   ============================================================ */
(function () {
  "use strict";
  if (window.Shadow3D) return;
  if (typeof THREE === "undefined") { console.warn("shadow3d: three.js missing - keeping the 2D figures"); return; }

  const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const coarse = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const isLite = () => document.documentElement.classList.contains("lite");
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rgbToHex = (s) => {
    const m = String(s || "").split(",").map((n) => clamp(parseInt(n, 10) || 0, 0, 255));
    return m.length === 3 ? "#" + m.map((n) => n.toString(16).padStart(2, "0")).join("") : null;
  };

  /* ------------------------------------------------------------
     SHADERS  (one lit material family, so a whole warrior is cheap)
     ------------------------------------------------------------ */
  const VERT = `
    varying vec3 vN; varying vec3 vV;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`;

  const FRAG_BODY = `
    uniform vec3 uBase; uniform vec3 uRim; uniform float uRimK; uniform float uPulse; uniform float uSpec;
    varying vec3 vN; varying vec3 vV;
    void main(){
      vec3 n = normalize(vN);
      vec3 v = normalize(vV);
      float nv = clamp(dot(n, v), 0.0, 1.0);
      float rim = pow(1.0 - nv, 2.3);
      vec3 L = normalize(vec3(-0.45, 0.75, 0.55));
      float diff = max(dot(n, L), 0.0);
      float sp = pow(max(dot(reflect(-L, n), v), 0.0), 26.0);
      vec3 col = uBase * (0.8 + 1.6 * diff);
      col += uRim * rim * uRimK * (1.35 + uPulse * 1.2);
      col += vec3(0.8, 0.75, 1.0) * sp * uSpec;
      col += uRim * 0.12 * clamp(-n.y, 0.0, 1.0);
      gl_FragColor = vec4(col, 1.0);
    }`;

  const FRAG_GLOW = `
    uniform vec3 uColor; uniform float uTime;
    void main(){ gl_FragColor = vec4(uColor * (1.15 + 0.2 * sin(uTime * 3.0)), 1.0); }`;

  const VERT_CAPE = `
    uniform float uTime; uniform float uWave;
    varying vec3 vN; varying vec3 vV; varying vec2 vUv;
    void main(){
      vUv = uv;
      vec3 p = position;
      float k = 1.0 - uv.y;
      p.x *= 1.0 + k * 0.55;
      p.z -= k * (0.02 + uWave * 0.16);
      p.z += sin(uTime * 2.3 + uv.y * 5.0 + uv.x * 3.0) * (0.012 + 0.04 * uWave) * k;
      p.x += sin(uTime * 1.7 + uv.y * 4.0) * 0.012 * k;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`;

  const FRAG_CAPE = `
    uniform vec3 uRim; uniform float uTime;
    varying vec3 vN; varying vec3 vV; varying vec2 vUv;
    void main(){
      float edge = 0.05 + 0.07 * abs(sin(vUv.x * 28.0 + uTime * 0.6)) + 0.04 * sin(vUv.x * 61.0);
      if (vUv.y < edge) discard;
      vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
      float nv = clamp(dot(n, normalize(vV)), 0.0, 1.0);
      float rim = pow(1.0 - nv, 2.0);
      float hem = pow(1.0 - vUv.y, 3.0);
      vec3 col = mix(vec3(0.025, 0.015, 0.06), uRim * 0.5, hem * 0.6) + uRim * rim * 0.55;
      gl_FragColor = vec4(col, 1.0);
    }`;

  const VERT_SMOKE = `
    attribute vec4 aSeed; uniform float uTime; uniform float uPx;
    varying float vA;
    void main(){
      float life = fract(aSeed.x + uTime * (0.10 + aSeed.y * 0.10));
      float ang = aSeed.z * 6.2832 + uTime * 0.6 * (aSeed.w - 0.5);
      float rad = (0.05 + aSeed.w * 0.13) * (0.6 + life * 0.8);
      vec3 p = vec3(cos(ang) * rad, life * 1.05 + 0.02, sin(ang) * rad * 0.7);
      p.x += sin(uTime * 0.9 + aSeed.y * 9.0) * 0.03 * life;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      gl_PointSize = max(1.0, uPx * (0.05 + life * 0.11));
      vA = sin(life * 3.1416) * 0.6;
    }`;

  const FRAG_SMOKE = `
    uniform vec3 uRim; varying float vA;
    void main(){
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.0, d) * vA;
      gl_FragColor = vec4(uRim * 1.3 * a, a * 0.6);
    }`;

  const PREMUL = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };

  function shade(uni, base, rimK, spec) {
    return new THREE.ShaderMaterial({
      uniforms: { uRim: uni.uRim, uPulse: uni.uPulse, uBase: { value: new THREE.Color(base) }, uRimK: { value: rimK }, uSpec: { value: spec } },
      vertexShader: VERT, fragmentShader: FRAG_BODY
    });
  }
  function glow(uni, hex) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: uni.uTime, uColor: hex ? { value: new THREE.Color(hex) } : uni.uRim },
      vertexShader: VERT, fragmentShader: FRAG_GLOW
    });
  }
  function capeMat(uni) {
    return new THREE.ShaderMaterial({
      uniforms: { uTime: uni.uTime, uWave: uni.uWave, uRim: uni.uRim },
      vertexShader: VERT_CAPE, fragmentShader: FRAG_CAPE, side: THREE.DoubleSide
    });
  }

  /* ------------------------------------------------------------
     GEOMETRY helpers (shared + cached, never re-created per warrior)
     ------------------------------------------------------------ */
  const gcache = {};
  const geo = (key, make) => gcache[key] || (gcache[key] = make());
  const cyl = (rt, rb, h, s) => geo("c" + [rt, rb, h, s || 8], () => new THREE.CylinderGeometry(rt, rb, h, s || 8));
  const box = (w, h, d) => geo("b" + [w, h, d], () => new THREE.BoxGeometry(w, h, d));
  const sph = (r, w, h) => geo("s" + [r, w || 12, h || 9], () => new THREE.SphereGeometry(r, w || 12, h || 9));
  const cone = (r, h, s) => geo("k" + [r, h, s || 6], () => new THREE.ConeGeometry(r, h, s || 6));
  const disc = (r) => geo("d" + r, () => new THREE.CircleGeometry(r, 14));
  const limb = (len, r0, r1) => geo("l" + [len, r0, r1], () => {
    const g = new THREE.CylinderGeometry(r0, r1, len, 7);
    g.translate(0, -len / 2, 0);
    return g;
  });
  function mesh(g, mat, parent, x, y, z, rx, ry, rz) {
    const o = new THREE.Mesh(g, mat);
    o.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) o.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(o);
    return o;
  }
  function pivot(parent, x, y, z) {
    const o = new THREE.Object3D();
    o.position.set(x || 0, y || 0, z || 0);
    parent.add(o);
    return o;
  }

  /* ------------------------------------------------------------
     WEAPONS  (local +y is the blade direction)
     ------------------------------------------------------------ */
  function addWeapon(kind, w, M, tier) {
    w.scale.setScalar(1 + tier * 0.07);
    mesh(cyl(0.012, 0.012, 0.1, 6), M.armor, w, 0, 0, 0);
    const blade = (len, wid) => {
      mesh(box(wid, len, 0.008), M.edge, w, 0, 0.06 + len / 2, 0);
      mesh(box(wid * 0.55, len * 0.98, 0.013), M.armor, w, 0, 0.06 + len / 2, 0);
    };
    const shaft = (len, y) => mesh(cyl(0.009, 0.011, len, 6), M.armor, w, 0, y, 0);
    switch (kind) {
      case "blade": case "dagger":
        blade(0.22, 0.026); mesh(box(0.07, 0.012, 0.02), M.armor, w, 0, 0.055, 0); break;
      case "spear":
        shaft(1.0, 0.3); mesh(cone(0.026, 0.15, 4), M.edge, w, 0, 0.88, 0); break;
      case "bow":
        mesh(geo("bow", () => new THREE.TorusGeometry(0.3, 0.009, 5, 24, Math.PI)), M.armor, w, 0, 0.05, 0, 0, 0, -Math.PI / 2);
        mesh(box(0.003, 0.6, 0.003), M.edge, w, 0, 0.05, 0); break;
      case "staff":
        shaft(1.05, 0.32); mesh(sph(0.042, 10, 8), M.glow, w, 0, 0.9, 0);
        [-1, 1].forEach((s) => mesh(cone(0.012, 0.1, 4), M.armor, w, s * 0.05, 0.86, 0, 0, 0, -s * 0.5)); break;
      case "scythe":
        shaft(1.0, 0.3);
        mesh(geo("scy", () => new THREE.TorusGeometry(0.2, 0.012, 4, 16, 2.2)), M.edge, w, -0.02, 0.78, 0, 0, 0, 0.2); break;
      case "axe":
        shaft(0.95, 0.28); mesh(box(0.17, 0.15, 0.02), M.edge, w, 0.09, 0.66, 0); mesh(box(0.03, 0.2, 0.035), M.armor, w, 0, 0.66, 0); break;
      case "club":
        mesh(cyl(0.055, 0.022, 0.62, 7), M.armor, w, 0, 0.32, 0);
        [0.45, 0.55].forEach((y, i) => mesh(cone(0.014, 0.06, 4), M.edge, w, i ? -0.045 : 0.045, y, 0, 0, 0, i ? 1.5 : -1.5)); break;
      default: // sword, crown, shield
        blade(0.5, 0.036); mesh(box(0.12, 0.016, 0.028), M.armor, w, 0, 0.055, 0);
    }
  }

  /* ------------------------------------------------------------
     RIG: the warrior itself. Feet on y=0, about 1 unit tall, faces +z.
     ------------------------------------------------------------ */
  const STANCE = {
    idle:  { hip: [-0.05, 0.08], knee: [0.08, 0.12], drop: 0,    R: [-0.30, -0.85], L: [-0.10, -0.50], lean: 0 },
    ready: { hip: [-0.30, 0.24], knee: [0.45, 0.30], drop: 0.04, R: [-0.60, -1.60], L: [-0.90, -1.40], lean: 0.05 },
    low:   { hip: [-0.45, -0.45], knee: [0.90, 0.90], drop: 0.10, R: [-0.15, -0.50], L: [0.10, -0.30], lean: 0.14 },
    cheer: { hip: [-0.10, 0.10], knee: [0.15, 0.15], drop: 0,    R: [-2.85, -0.25], L: [-0.45, -0.60], lean: -0.05 }
  };

  function swingCurve(s) {           // 0..1  ->  raise, strike, recover
    if (s < 0.35) { const a = easeOut(s / 0.35); return { x: lerp(0, -2.7, a), ex: lerp(0, -0.5, a), tw: 0.5 * a, lean: 0, k: 0 }; }
    if (s < 0.6)  { const b = (s - 0.35) / 0.25, e = easeOut(b); return { x: lerp(-2.7, -0.2, e), ex: -0.5, tw: lerp(0.5, -0.6, b), lean: 0.25 * b, k: 1 }; }
    const c = easeOut((s - 0.6) / 0.4);
    return { x: lerp(-0.2, 0, c), ex: lerp(-0.5, 0, c), tw: lerp(-0.6, 0, c), lean: 0.25 * (1 - c), k: 2 };
  }

  function buildRig(spec) {
    spec = spec || {};
    const tier = clamp(spec.tier | 0, 0, 3), boss = !!spec.boss, hero = !!spec.hero;
    const kind = boss ? "club" : (spec.kind || "sword");
    const rimHex = spec.rim || (boss ? "#ff4666" : hero ? "#8f7bff" : "#a855f7");
    const eyeHex = spec.eye || (boss ? "#ff4d6d" : hero ? "#bfe0ff" : "#c4b5fd");
    const uni = {
      uTime: { value: Math.random() * 20 }, uRim: { value: new THREE.Color(rimHex) },
      uPulse: { value: 0 }, uWave: { value: 0 }, uPx: { value: 200 }
    };
    const M = {
      body: shade(uni, boss ? 0x160409 : 0x0a0714, 1.0, 0.25),
      armor: shade(uni, boss ? 0x2e0d1b : 0x1d1636, 1.5, 0.7),
      glow: glow(uni, eyeHex), edge: glow(uni, hero ? "#e4eaff" : boss ? "#ffc0cc" : "#eadfff"),
      core: glow(uni, null), gold: glow(uni, "#f2c46b"), cape: capeMat(uni),
      void: new THREE.MeshBasicMaterial({ color: 0x000000 })
    };

    const root = new THREE.Group();
    const yaw = pivot(root);
    const hips = pivot(yaw, 0, 0.5, 0);
    const torso = pivot(hips, 0, 0.03, 0);

    // ground glow (screen-facing blob under the feet)
    const blob = new THREE.Mesh(geo("blob", () => new THREE.PlaneGeometry(1, 1)), new THREE.ShaderMaterial(Object.assign({
      uniforms: { uRim: uni.uRim },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 uRim; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.0) * 0.55; gl_FragColor = vec4(uRim * a, a); }"
    }, PREMUL)));
    blob.scale.set(1.0, 0.26, 1); blob.position.y = 0.004; blob.renderOrder = -1;
    root.add(blob);

    // pelvis, belt, tassets
    mesh(cyl(0.085, 0.078, 0.1, 8), M.body, hips, 0, 0, 0).scale.z = 0.75;
    mesh(cyl(0.092, 0.092, 0.026, 8), M.armor, hips, 0, 0.045, 0).scale.z = 0.78;
    mesh(box(0.09, 0.15, 0.012), M.armor, hips, 0, -0.09, 0.072, 0.12, 0, 0);
    mesh(box(0.09, 0.15, 0.012), M.armor, hips, 0, -0.09, -0.072, -0.12, 0, 0);

    // legs
    const legs = [-1, 1].map((s) => {
      const hip = pivot(hips, s * 0.055, -0.02, 0);
      mesh(limb(0.24, 0.048, 0.034), M.body, hip);
      mesh(sph(0.032, 8, 6), M.armor, hip, 0, -0.24, 0.024);
      const knee = pivot(hip, 0, -0.24, 0);
      mesh(limb(0.22, 0.034, 0.03), M.body, knee);
      mesh(cyl(0.04, 0.045, 0.07, 6), M.armor, knee, 0, -0.075, 0);
      mesh(box(0.062, 0.05, 0.12), M.armor, knee, 0, -0.22, 0.025);
      mesh(cone(0.028, 0.06, 5), M.armor, knee, 0, -0.22, 0.1, Math.PI / 2, 0, 0);
      return { hip, knee };
    });

    // chest
    mesh(cyl(0.125, 0.082, 0.27, 8), M.body, torso, 0, 0.135, 0).scale.z = 0.62;
    mesh(cyl(0.135, 0.095, 0.19, 8), M.armor, torso, 0, 0.18, 0.006).scale.z = 0.7;
    mesh(sph(0.02, 8, 6), M.core, torso, 0, 0.19, 0.088);
    mesh(cyl(0.085, 0.11, 0.07, 8), M.armor, torso, 0, 0.3, 0).scale.z = 0.8;

    // cape (vertex-animated, ragged hem)
    const capeLen = 0.5 + tier * 0.07;
    const capeG = geo("cape" + capeLen, () => { const g = new THREE.PlaneGeometry(0.3, capeLen, 6, 10); g.translate(0, -capeLen / 2, 0); return g; });
    mesh(capeG, M.cape, torso, 0, 0.28, -0.075);

    // arms + pauldrons
    const padS = 1 + tier * 0.14 + (hero ? 0.1 : 0);
    const arms = [-1, 1].map((s) => {
      const sh = pivot(torso, s * 0.158, 0.25, 0);
      const pad = mesh(sph(0.06, 10, 8), M.armor, sh, s * 0.012, 0.02, 0);
      pad.scale.set(padS * 1.05, padS * 0.65, padS);
      const spikes = hero ? 2 : tier;
      for (let i = 0; i < spikes; i++) mesh(cone(0.014, 0.075 + 0.02 * tier, 5), M.armor, sh, s * (0.045 + i * 0.025), 0.03 + i * 0.014, 0, 0, 0, -s * (1.15 + i * 0.25));
      mesh(limb(0.17, 0.03, 0.026), M.body, sh);
      const el = pivot(sh, 0, -0.17, 0);
      mesh(limb(0.16, 0.026, 0.03), M.body, el);
      mesh(cyl(0.034, 0.038, 0.09, 6), M.armor, el, 0, -0.07, 0);
      const hand = pivot(el, 0, -0.165, 0);
      mesh(sph(0.03, 8, 6), M.armor, hand);
      return { s, sh, el, hand };
    });

    // head: hero = horned helm with a swept crest, soldiers = pointed hood
    const head = pivot(torso, 0, 0.3, 0);
    mesh(cyl(0.03, 0.036, 0.05, 6), M.body, head, 0, 0, 0);
    const skull = pivot(head, 0, 0.075, 0);
    if (hero) {
      mesh(sph(0.066, 14, 10), M.armor, skull).scale.set(0.92, 1.05, 1.02);
      mesh(cone(0.024, 0.17, 4), M.armor, skull, 0, 0.09, -0.07, -1.05, 0, 0);
      [-1, 1].forEach((s) => mesh(cone(0.018, 0.13, 5), M.armor, skull, s * 0.05, 0.06, -0.01, -0.9, 0, -s * 0.7));
    } else {
      mesh(sph(0.068, 12, 9), M.body, skull).scale.set(0.95, 1.05, 1.05);
      mesh(cone(0.075, 0.2, 8), M.body, skull, 0, 0.09, -0.012);
    }
    if (boss || tier >= 2) [-1, 1].forEach((s) => mesh(cone(0.02, 0.17, 5), M.armor, skull, s * 0.05, 0.11, 0, -0.2, 0, -s * 0.75));
    if (kind === "crown") for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; mesh(cone(0.014, 0.06, 4), M.gold, skull, Math.sin(a) * 0.05, 0.105, Math.cos(a) * 0.05); }
    mesh(sph(0.05, 10, 8), M.void, skull, 0, -0.005, 0.045).scale.set(0.95, 1.0, 0.6);
    [-1, 1].forEach((s) => mesh(disc(0.013), M.glow, skull, s * 0.024, 0.006, 0.082, 0, s * 0.3, s * -0.3).scale.x = 2.1);

    // weapons
    const W = pivot(arms[1].hand); W.rotation.x = Math.PI - 0.35;
    addWeapon(kind, W, M, tier);
    let orb = null;
    if (kind === "blade") { const W2 = pivot(arms[0].hand); W2.rotation.x = Math.PI - 0.35; addWeapon("dagger", W2, M, tier); }
    else if (kind === "shield") {
      mesh(cyl(0.12, 0.12, 0.02, 14), M.armor, arms[0].el, 0, -0.09, 0.07, Math.PI / 2, 0, 0);
      mesh(geo("shring", () => new THREE.TorusGeometry(0.12, 0.008, 6, 22)), M.edge, arms[0].el, 0, -0.09, 0.083);
    } else if (hero) { orb = mesh(sph(0.036, 10, 8), M.core, arms[0].hand, 0, -0.05, 0.03); }

    // smoke / aura
    let smoke = null;
    const smokeN = spec.smoke == null ? 26 : spec.smoke;
    if (smokeN > 0) {
      const g = new THREE.BufferGeometry(), seed = new Float32Array(smokeN * 4);
      for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(smokeN * 3), 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
      smoke = new THREE.Points(g, new THREE.ShaderMaterial(Object.assign({
        uniforms: { uTime: uni.uTime, uRim: uni.uRim, uPx: uni.uPx }, vertexShader: VERT_SMOKE, fragmentShader: FRAG_SMOKE
      }, PREMUL)));
      smoke.frustumCulled = false;
      root.add(smoke);
    }

    const seedPh = Math.random() * 6.28;
    function pose(p) {
      const t = p.t || 0, walk = p.walk || 0, run = p.run || 0, ph = p.phase || 0;
      const S = STANCE[p.stance] || STANCE.idle;
      const mv = clamp(walk + run, 0, 1);
      uni.uTime.value = t;
      uni.uWave.value = clamp(walk * 0.5 + run * 0.8 + (p.wave || 0), 0, 1.2) + 0.12;
      uni.uPulse.value = p.pulse || 0;
      const br = Math.sin(t * 1.7 + seedPh), sw = Math.sin(ph);
      const sc = p.swing != null && p.swing > 0 ? swingCurve(clamp(p.swing, 0, 1)) : null;

      yaw.rotation.y = p.yaw || 0;
      hips.position.y = 0.5 - S.drop * (1 - mv) + Math.abs(sw) * 0.024 * mv + br * 0.004 + (p.hop || 0);
      hips.rotation.z = sw * 0.05 * mv;
      torso.rotation.x = S.lean * (1 - mv) + run * 0.2 + (p.lean || 0) + (sc ? sc.lean : 0);
      torso.rotation.y = -sw * 0.14 * mv + (p.twist || 0) + (sc ? sc.tw : 0);
      torso.scale.y = 1 + br * 0.008;
      head.rotation.y = clamp(p.headYaw || 0, -0.9, 0.9) - torso.rotation.y * 0.7;
      head.rotation.x = clamp(p.headPitch || 0, -0.5, 0.5) - torso.rotation.x * 0.7;

      const amp = 0.62 * walk + 0.5 * run;
      legs.forEach((L, i) => {
        const a = ph + (i ? Math.PI : 0), q = Math.sin(a), c = Math.cos(a);
        L.hip.rotation.x = S.hip[i] * (1 - mv) - q * amp;
        L.knee.rotation.x = S.knee[i] * (1 - mv) + Math.max(0, c) * 0.95 * mv + 0.05;
      });

      const R = arms[1], Lf = arms[0];
      let rx = S.R[0] * (1 - mv * 0.6) + sw * 0.18 * mv + br * 0.02;
      let rex = S.R[1] * (1 - mv * 0.5);
      let lx = S.L[0] * (1 - mv * 0.7) - sw * 0.5 * mv - br * 0.02;
      const lex = S.L[1] * (1 - mv * 0.5);
      if (sc) { rx = lerp(rx, sc.x, 1); rex = lerp(rex, sc.ex - 0.4, 1); lx = lerp(lx, 0.2 - sc.k * 0.6, 0.8); }
      R.sh.rotation.set(rx, 0, 0.12); R.el.rotation.x = rex;
      Lf.sh.rotation.set(lx, 0, -0.12); Lf.el.rotation.x = lex;
      if (orb) { const k = 1 + (p.pulse || 0) * 0.6 + Math.sin(t * 4) * 0.08; orb.scale.setScalar(k); }
    }

    return {
      root, yaw, uni, mats: M, pose, kind,
      setPx(px) { uni.uPx.value = px; },
      setRim(hex, k) { const c = new THREE.Color(hex); if (k) uni.uRim.value.lerp(c, k); else uni.uRim.value.copy(c); },
      setEye(hex) { M.glow.uniforms.uColor.value.set(hex); },
      dispose() {
        root.traverse((o) => { if (o.material && o.material.dispose) o.material.dispose(); if (o.isPoints && o.geometry) o.geometry.dispose(); });
      }
    };
  }

  /* ------------------------------------------------------------
     A) 3D FIGURES INSIDE THE OLD 2D CANVASES  (legion, ARISE, bosses)
        script.js calls  Shadow3D.figure(g, x, y, h, opts)  first; if it
        returns true the 2D drawing is skipped.
     ------------------------------------------------------------ */
  const OFF = { ok: null, r: null, scene: null, cam: null, rigs: new Map(), W: 400, H: 500 };
  function offInit() {
    if (OFF.ok !== null) return OFF.ok;
    try {
      OFF.r = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
      OFF.r.setPixelRatio(1); OFF.r.setSize(OFF.W, OFF.H, false); OFF.r.setClearColor(0x000000, 0);
      OFF.scene = new THREE.Scene();
      OFF.cam = new THREE.PerspectiveCamera(24, OFF.W / OFF.H, 0.5, 30);
      OFF.cam.position.set(0, 0.625, 3.175);
      OFF.cam.lookAt(0, 0.625, 0);
      OFF.r.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); OFF.ok = false; });
      OFF.ok = true;
    } catch (e) { console.warn("shadow3d: offscreen renderer unavailable", e); OFF.ok = false; }
    return OFF.ok;
  }
  function figure(g, x, y, h, o) {
    o = o || {};
    if (o.faction === "hero" || h < 8 || !offInit()) return false;
    try {
      const tier = clamp(o.tier == null ? (o.boss ? 3 : 0) : o.tier, 0, 3);
      const key = [o.kind || "sword", tier, o.boss ? 1 : 0, o.eye || "", o.rimRgb || ""].join("|");
      let rig = OFF.rigs.get(key);
      if (!rig) {
        if (OFF.rigs.size >= 24) { const k0 = OFF.rigs.keys().next().value; OFF.rigs.get(k0).dispose(); OFF.rigs.delete(k0); }
        rig = buildRig({ kind: o.kind, tier: tier, boss: !!o.boss, eye: o.eye, rim: rgbToHex(o.rimRgb), smoke: 10 });
        rig.setPx(OFF.H / 1.35);
        OFF.rigs.set(key, rig);
      }
      OFF.scene.add(rig.root);
      rig.pose({ t: o.t || 0, stance: o.stance || "idle", wave: 0.15 });
      OFF.r.render(OFF.scene, OFF.cam);
      OFF.scene.remove(rig.root);

      const rim = o.rimRgb || (o.boss ? "255,70,96" : "168,85,247");
      const dh = h * 1.35, dw = dh * (OFF.W / OFF.H);
      g.save();
      g.globalAlpha = o.alpha == null ? 1 : o.alpha;
      const gr = g.createRadialGradient(x, y, h * 0.03, x, y, h * 0.5);
      gr.addColorStop(0, "rgba(" + rim + ",.4)"); gr.addColorStop(1, "rgba(" + rim + ",0)");
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, h * 0.5, h * 0.1, 0, 0, 6.283); g.fill();
      g.drawImage(OFF.r.domElement, x - dw / 2, y - h * 1.3, dw, dh);
      g.restore();
      return true;
    } catch (e) { console.warn("shadow3d: figure failed, using 2D", e); OFF.ok = false; return false; }
  }

  /* ------------------------------------------------------------
     B) THE COMPANION  (full-screen transparent 3D overlay)
     ------------------------------------------------------------ */
  const LINES = {
    focus: ["Let\u2019s begin.", "Eyes forward.", "Stay with it."],
    break: ["Breathe. Back to it soon.", "Good pause."],
    alert: ["Your streak needs you today.", "Don\u2019t let today slip."],
    cheerSmall: ["Good.", "Nice.", "Keep going."],
    cheerBig: ["Level up. Well earned.", "That\u2019s real progress."],
    poke: ["I\u2019m watching your back.", "Back to work?", "Need something cut down?", "Shadows don\u2019t sleep."],
    idle: ["Ten more minutes?", "Your next task is waiting.", "Ready when you are."],
    arise: ["Arise.", "Rise."]
  };
  const MOOD = {
    idle:  { rim: null,      eye: "#bfe0ff", st: "idle" },
    focus: { rim: "#e8734a", eye: "#ffd7c2", st: "ready" },
    break: { rim: "#4fb397", eye: "#c9ffe9", st: "idle" },
    alert: { rim: "#d2785a", eye: "#e8b5a0", st: "low" }
  };
  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="tab"],[data-go],.chip,.seg,.switch,.dock,.topbar';
  const IGNORE = "#arise,#palette,.palette-backdrop,.zen-exit";

  const prefs = (function () {
    let p = { on: true, sfx: false };
    try { p = Object.assign(p, JSON.parse(localStorage.getItem("sf_s3d") || "{}")); } catch (e) { /* ignore */ }
    return p;
  })();
  const savePrefs = () => { try { localStorage.setItem("sf_s3d", JSON.stringify(prefs)); } catch (e) { /* ignore */ } };

  const C = {
    ready: false, on: false, renderer: null, scene: null, camera: null, canvas: null, W: 0, H: 0, dpr: 1, S: 150, camZ: 2000,
    rig: null, pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, cursor: { x: 0, y: 0, has: false },
    mood: "idle", t: 0, phase: 0, yaw: 0, atk: null, dash: null, combo: 0, lastHit: 0, lastMove: performance.now(),
    hopT: 0, cheerT: 0, enter: 1, fx: [], minions: [], pool: [], army: [], armyIds: "", trail: [], trailT: 0,
    sparks: null, line: null, lineTimer: 0, lastSave: 0, nextIdle: performance.now() + 60000, raf: 0, last: 0, lastRender: 0
  };

  const wx = (x) => x - C.W / 2;
  const wy = (y) => C.H / 2 - y;
  const clampX = (x) => clamp(x, C.S * 0.35, C.W - C.S * 0.35);
  const clampY = (y) => clamp(y, C.S + 70, C.H - 6);
  const armyMax = () => (isLite() || reduce ? 0 : (coarse || C.W < 760 ? 1 : 3));
  const depthScale = (y) => lerp(0.85, 1.12, clamp(y / Math.max(1, C.H), 0, 1));

  function accentHex() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return /^#[0-9a-f]{3,8}$/i.test(v) ? v : "#8f7bff";
  }

  /* ---------- sound (opt-in) ---------- */
  let ac = null;
  function whoosh(big) {
    if (!prefs.sfx) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
      const t = ac.currentTime, len = Math.floor(ac.sampleRate * 0.35);
      const b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const s = ac.createBufferSource(); s.buffer = b;
      const f = ac.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.2;
      f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(big ? 2600 : 3800, t + 0.28);
      const g = ac.createGain(); g.gain.value = big ? 0.3 : 0.16;
      s.connect(f); f.connect(g); g.connect(ac.destination); s.start(t);
      if (big) {
        const o = ac.createOscillator(), og = ac.createGain();
        o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
        og.gain.setValueAtTime(0.35, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        o.connect(og); og.connect(ac.destination); o.start(t); o.stop(t + 0.5);
      }
    } catch (e) { /* audio not available */ }
  }

  /* ---------- effects: rings, slashes, sparks ---------- */
  const RING_GEO = () => geo("ring", () => new THREE.RingGeometry(0.9, 1, 64));
  const SLASH_LEN = 2.2;
  const SLASH_GEO = () => geo("slash", () => new THREE.RingGeometry(0.55, 1, 32, 1, -SLASH_LEN / 2, SLASH_LEN));

  function fxMaterial(frag, uniforms, vert) {
    return new THREE.ShaderMaterial(Object.assign({
      uniforms: uniforms,
      vertexShader: vert || "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: frag
    }, PREMUL));
  }
  function ring(x, y, R, dur, hex, flat) {
    const m = fxMaterial("uniform vec3 uColor; uniform float uA; void main(){ gl_FragColor = vec4(uColor * uA, uA); }",
      { uColor: { value: new THREE.Color(hex || C.rimHex) }, uA: { value: 1 } });
    const o = new THREE.Mesh(RING_GEO(), m);
    o.position.set(wx(x), wy(y), 20); o.scale.set(6, 6, 1); o.frustumCulled = false;
    C.scene.add(o);
    let a = 0;
    C.fx.push(function (dt) {
      a += dt / dur; const e = easeOut(a);
      const r = lerp(6, R, e); o.scale.set(r, r * (flat ? 0.35 : 1), 1);
      m.uniforms.uA.value = (1 - a) * 0.9;
      if (a >= 1) { C.scene.remove(o); m.dispose(); return false; }
      return true;
    });
  }
  function slash(x, y, size, angle, hex) {
    const m = fxMaterial(
      "uniform vec3 uColor; uniform float uA; uniform float uLen; varying vec3 vP;" +
      "void main(){ float a = atan(vP.y, vP.x); float tt = clamp((a + uLen * 0.5) / uLen, 0.0, 1.0);" +
      "float rn = clamp((length(vP.xy) - 0.55) / 0.45, 0.0, 1.0);" +
      "float al = pow(sin(tt * 3.1416), 0.8) * (1.0 - rn * 0.85) * uA;" +
      "gl_FragColor = vec4(mix(vec3(1.0), uColor, rn) * al, al); }",
      { uColor: { value: new THREE.Color(hex || C.rimHex) }, uA: { value: 1 }, uLen: { value: SLASH_LEN } });
    const o = new THREE.Mesh(SLASH_GEO(), m);
    o.position.set(wx(x), wy(y), 24); o.rotation.z = angle; o.frustumCulled = false;
    C.scene.add(o);
    let a = 0;
    C.fx.push(function (dt) {
      a += dt / 0.3; const e = easeOut(a), r = size * lerp(0.7, 1.05, e);
      o.scale.set(r, r, 1); o.rotation.z = angle + e * 0.25; m.uniforms.uA.value = 1 - a;
      if (a >= 1) { C.scene.remove(o); m.dispose(); return false; }
      return true;
    });
  }

  const SP_N = 320;
  const sp = { i: 0, x: new Float32Array(SP_N), y: new Float32Array(SP_N), vx: new Float32Array(SP_N), vy: new Float32Array(SP_N),
    life: new Float32Array(SP_N), max: new Float32Array(SP_N), size: new Float32Array(SP_N), col: new Float32Array(SP_N * 3) };
  function initSparks() {
    const g = new THREE.BufferGeometry();
    sp.pos = new THREE.BufferAttribute(new Float32Array(SP_N * 3), 3);
    sp.aSize = new THREE.BufferAttribute(new Float32Array(SP_N), 1);
    sp.aA = new THREE.BufferAttribute(new Float32Array(SP_N), 1);
    sp.aCol = new THREE.BufferAttribute(sp.col, 3);
    [sp.pos, sp.aSize, sp.aA].forEach((a) => a.setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("position", sp.pos); g.setAttribute("aSize", sp.aSize); g.setAttribute("aA", sp.aA); g.setAttribute("aCol", sp.aCol);
    sp.mat = new THREE.ShaderMaterial(Object.assign({
      uniforms: { uDpr: { value: C.dpr } },
      vertexShader: "attribute float aSize; attribute float aA; attribute vec3 aCol; uniform float uDpr; varying vec3 vC; varying float vA;" +
        "void main(){ vC = aCol; vA = aA; gl_PointSize = aSize * uDpr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: "varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vA; gl_FragColor = vec4(vC * a * 1.4, a * 0.85); }"
    }, PREMUL));
    sp.points = new THREE.Points(g, sp.mat);
    sp.points.frustumCulled = false; sp.points.position.z = 30;
    C.scene.add(sp.points);
  }
  function burst(x, y, n, o) {
    if (!sp.points || reduce) return;
    o = o || {};
    const c = new THREE.Color(o.color || C.rimHex), white = new THREE.Color("#ffffff");
    for (let k = 0; k < n; k++) {
      const i = sp.i = (sp.i + 1) % SP_N, a = Math.random() * 6.283, v = (o.speed || 260) * (0.3 + Math.random() * 0.9);
      sp.x[i] = wx(x); sp.y[i] = wy(y);
      sp.vx[i] = Math.cos(a) * v; sp.vy[i] = Math.sin(a) * v + (o.up || 60);
      sp.life[i] = 0; sp.max[i] = (o.life || 0.7) * (0.6 + Math.random() * 0.8);
      sp.size[i] = (o.size || 9) * (0.5 + Math.random());
      const m = c.clone().lerp(white, Math.random() * 0.5);
      sp.col[i * 3] = m.r; sp.col[i * 3 + 1] = m.g; sp.col[i * 3 + 2] = m.b;
    }
    sp.aCol.needsUpdate = true;
  }
  function updateSparks(dt) {
    if (!sp.points) return;
    const P = sp.pos.array, Z = sp.aSize.array, A = sp.aA.array;
    for (let i = 0; i < SP_N; i++) {
      if (sp.life[i] >= sp.max[i]) { Z[i] = 0; A[i] = 0; continue; }
      sp.life[i] += dt;
      sp.vx[i] *= 0.96; sp.vy[i] = sp.vy[i] * 0.96 - 240 * dt;
      sp.x[i] += sp.vx[i] * dt; sp.y[i] += sp.vy[i] * dt;
      const k = sp.life[i] / sp.max[i];
      P[i * 3] = sp.x[i]; P[i * 3 + 1] = sp.y[i]; P[i * 3 + 2] = 0;
      Z[i] = sp.size[i] * (1 - k * 0.6); A[i] = 1 - k;
    }
    sp.pos.needsUpdate = true; sp.aSize.needsUpdate = true; sp.aA.needsUpdate = true;
  }

  /* ---------- speech bubble ---------- */
  function say(text, ms) {
    if (!C.line || !text || !C.on) return;
    C.line.textContent = text; C.line.classList.add("on");
    clearTimeout(C.lineTimer);
    C.lineTimer = setTimeout(() => C.line.classList.remove("on"), ms || 3200);
  }

  /* ---------- actions ---------- */
  function attack(x, y) {
    const now = performance.now();
    C.combo = now - C.lastHit < 800 ? C.combo + 1 : 1; C.lastHit = now;
    const finisher = C.combo >= 3; if (finisher) C.combo = 0;
    const dir = x >= C.pos.x ? 1 : -1;
    C.dash = null;
    if (C.mood !== "focus" && !reduce) {
      const dx = x - C.pos.x, dy = y - (C.pos.y - C.S * 0.5), d = Math.hypot(dx, dy) || 1;
      if (d > C.S * 0.95) {
        burst(C.pos.x, C.pos.y - C.S * 0.4, 14, { speed: 140, size: 14, life: 0.6 });
        C.dash = { t: 0, dur: clamp(d / 1800, 0.12, 0.3), sx: C.pos.x, sy: C.pos.y, ex: clampX(x - dx / d * C.S * 0.75), ey: clampY(y - dy / d * C.S * 0.75 + C.S * 0.5) };
      }
    }
    C.atk = { t: C.dash ? -C.dash.dur : 0, dur: finisher ? 0.6 : 0.46, dir: dir, x: x, y: y, fired: false, big: finisher, n: C.combo };
    C.army.forEach((f, i) => { f.swingAt = 0.1 + i * 0.09; f.swingT = -1; f.dir = dir; });
    whoosh(finisher);
  }
  function hit(a) {
    const size = a.big ? C.S * 1.15 : C.S * 0.62;
    slash(a.x, a.y, size, (a.n % 2 ? 0.7 : -0.7) + (a.dir < 0 ? Math.PI : 0), a.big ? "#ffffff" : null);
    ring(a.x, a.y, a.big ? C.S * 1.9 : C.S * 0.75, a.big ? 0.65 : 0.4, null, a.big);
    burst(a.x, a.y, a.big ? 70 : 26, { speed: a.big ? 420 : 260, size: a.big ? 12 : 9 });
    if (a.big) { say(pick(LINES.arise), 1500); whoosh(true); }
  }
  function nudge(x, y) {
    ring(x, y, 34, 0.35, null);
    burst(x, y, 6, { speed: 120, size: 6, life: 0.45 });
    C.nudgeT = 0.35; C.nudgeX = x;
  }
  function poke() {
    C.hopT = 0.5; say(pick(LINES.poke), 2600);
    ring(C.pos.x, C.pos.y, C.S * 0.8, 0.5, null, true);
    burst(C.pos.x, C.pos.y - C.S * 0.5, 16, { speed: 200 });
  }
  function getMinionRig(i) {
    if (!C.pool[i]) {
      const r = buildRig({ kind: ["blade", "spear", "sword"][i % 3], tier: 1, smoke: 8 });
      C.pool[i] = r;
    }
    return C.pool[i];
  }
  function summon(x, y) {
    if (!C.on || C.minions.length) return;
    ring(x, y, C.S * 1.4, 0.9, null, true);
    burst(x, y, 40, { speed: 300, size: 11 });
    say(pick(LINES.arise), 1800);
    for (let i = 0; i < 3; i++) {
      const rig = getMinionRig(i);
      rig.setRim("#a855f7"); rig.setPx(C.S * 0.62 * C.dpr);
      C.scene.add(rig.root);
      C.minions.push({ rig: rig, x: clamp(x + (i - 1) * C.S * 0.6, C.S * 0.3, C.W - C.S * 0.3), y: clamp(y + (i === 1 ? 6 : C.S * 0.12), C.S * 0.7 + 60, C.H - 4), age: -i * 0.12, life: 3.6 });
    }
    whoosh(true);
  }
  function cheer(big) {
    C.cheerT = 1.0; C.hopT = 0.5;
    burst(C.pos.x, C.pos.y - C.S * 0.9, big ? 60 : 24, { speed: 320, up: 200, size: 10, color: big ? "#ffd27a" : null });
    if (big) ring(C.pos.x, C.pos.y, C.S * 1.6, 0.8, null, true);
    say(pick(big ? LINES.cheerBig : LINES.cheerSmall), big ? 4200 : 2400);
  }
  function setMood(next, line) {
    if (!MOOD[next]) next = "idle";
    C.mood = next;
    if (line) say(line);
    else if (LINES[next] && next !== "idle") say(pick(LINES[next]), 2800);
  }

  /* ---------- army: the shadows you have extracted follow Umbra ---------- */
  const tierOf = (scale) => clamp(Math.round(((scale || 1) - 0.8) / 0.8 * 3), 0, 3);
  function refreshArmy() {
    if (!C.ready) return;
    const sys = window.SF && window.SF.system;
    let list = [];
    try { list = sys && sys.legion ? sys.legion() : []; } catch (e) { list = []; }
    const pickList = list.slice(0, armyMax());
    const ids = pickList.map((s) => s.id).join(",");
    if (ids === C.armyIds) return;
    C.armyIds = ids;
    C.army.forEach((f) => { C.scene.remove(f.rig.root); f.rig.dispose(); });
    C.army = pickList.map((sh, i) => {
      const rig = buildRig({ kind: sh.kind, eye: sh.eye, tier: tierOf(sh.scale), smoke: 10 });
      C.scene.add(rig.root);
      return { rig: rig, scale: clamp(0.55 + 0.28 * (sh.scale - 0.8), 0.55, 1.0), x: C.pos.x, y: C.pos.y, vx: 0, vy: 0, phase: Math.random() * 6, yaw: 0, rise: 0, swingT: -1, swingAt: 0, dir: 1, i: i, name: sh.name };
    });
  }

  /* ---------- per-frame update ---------- */
  const OFFS = [[0.72, 0.05], [1.4, 0.1], [2.05, 0.14]];
  function update(dt, now) {
    C.t += dt;
    const S = C.S;
    const park = C.mood === "focus" || reduce || !C.cursor.has;
    let tx = C.pos.x, ty = C.pos.y;
    if (park) {
      tx = S * 0.7 + 10; ty = C.H - (C.W < 760 ? 104 : 26);
    } else {
      const cx = C.cursor.x, cy = C.cursor.y;
      const dx = C.pos.x - cx, dy = (C.pos.y - S * 0.5) - cy, d = Math.hypot(dx, dy) || 1, keep = S * 0.85;
      if (d > keep * 1.15 || d < keep * 0.6) { tx = cx + dx / d * keep; ty = cy + dy / d * keep + S * 0.5; }
    }
    tx = clampX(tx); ty = clampY(ty);

    // dash or walk
    if (C.dash) {
      const D = C.dash; D.t += dt;
      const e = easeOut(D.t / D.dur), px = C.pos.x, py = C.pos.y;
      C.pos.x = lerp(D.sx, D.ex, e); C.pos.y = lerp(D.sy, D.ey, e);
      C.vel.x = (C.pos.x - px) / Math.max(dt, 0.001); C.vel.y = (C.pos.y - py) / Math.max(dt, 0.001);
      if (Math.random() < 0.7) burst(C.pos.x, C.pos.y - S * 0.35, 2, { speed: 60, size: 12, life: 0.5 });
      if (D.t >= D.dur) C.dash = null;
    } else {
      const ex = tx - C.pos.x, ey = ty - C.pos.y, dist = Math.hypot(ex, ey);
      const planted = !!C.atk && C.atk.t >= 0 && C.atk.t < C.atk.dur;
      const maxSp = dist > S * 2.4 ? 680 : 240;
      const want = planted || dist < 6 ? 0 : Math.min(maxSp, dist * 3.4);
      C.vel.x = damp(C.vel.x, dist ? ex / dist * want : 0, 7, dt);
      C.vel.y = damp(C.vel.y, dist ? ey / dist * want : 0, 7, dt);
      C.pos.x += C.vel.x * dt; C.pos.y += C.vel.y * dt;
    }
    const speed = Math.hypot(C.vel.x, C.vel.y);
    const walk = clamp(speed / 200, 0, 1), run = clamp((speed - 250) / 380, 0, 1);
    C.phase += (speed / S) * 4.2 * dt;

    // facing + look
    let yawT = 0;
    if (speed > 28) yawT = clamp(C.vel.x / 220, -1, 1) * 1.05;
    else if (C.cursor.has) yawT = clamp((C.cursor.x - C.pos.x) / (C.W * 0.35), -1, 1) * 0.5;
    if (C.atk) yawT = C.atk.dir * 0.8;
    C.yaw = damp(C.yaw, yawT, 8, dt);
    const idleFor = (now - C.lastMove) / 1000;
    let aim = C.cursor.has ? clamp((C.cursor.x - C.pos.x) / (S * 2.2), -1, 1) * 0.9 : 0;
    let pitch = C.cursor.has ? -clamp(((C.pos.y - S * 0.9) - C.cursor.y) / (C.H * 0.5), -1, 1) * 0.45 : 0;
    if (idleFor > 8 || !C.cursor.has) { aim = Math.sin(C.t * 0.6) * 0.6; pitch = Math.sin(C.t * 0.4) * 0.1; }
    if (C.nudgeT > 0) { C.nudgeT -= dt; aim = clamp((C.nudgeX - C.pos.x) / (S * 2), -1, 1) * 0.9; pitch = 0.25 * Math.sin(C.nudgeT * 18); }

    // swing + hop + cheer
    let swing = null;
    if (C.atk) {
      C.atk.t += dt;
      const s = C.atk.t / C.atk.dur;
      if (s > 0) swing = s;
      if (!C.atk.fired && s >= 0.5) { C.atk.fired = true; hit(C.atk); }
      if (s >= 1) C.atk = null;
    }
    let hop = 0;
    if (C.hopT > 0) { C.hopT -= dt; hop = Math.sin(Math.PI * clamp(1 - C.hopT / 0.5, 0, 1)) * 0.13; }
    let stance = MOOD[C.mood].st;
    if (C.cheerT > 0) { C.cheerT -= dt; stance = "cheer"; }
    if (C.atk && stance === "idle") stance = "ready";

    // mood colours
    const rimTarget = MOOD[C.mood].rim || C.accent;
    C.rimHex = rimTarget;
    C.rig.setRim(rimTarget, Math.min(1, dt * 4));
    if (C.eyeNow !== MOOD[C.mood].eye) { C.eyeNow = MOOD[C.mood].eye; C.rig.setEye(C.eyeNow); }

    // pose + place the hero
    C.enter = Math.min(1, C.enter + dt / 0.9);
    const sc = S * depthScale(C.pos.y);
    C.rig.pose({
      t: C.t, walk: walk, run: run, phase: C.phase, yaw: C.yaw, stance: stance, swing: swing,
      headYaw: aim - C.yaw, headPitch: pitch, hop: hop, pulse: C.cheerT > 0 ? 1 : (C.atk ? 0.6 : 0.15), wave: C.cheerT > 0 ? 0.6 : 0
    });
    const rise = easeOut(C.enter);
    C.rig.root.position.set(wx(C.pos.x), wy(C.pos.y), (C.pos.y / C.H) * 80);
    C.rig.root.scale.set(sc, sc * Math.max(0.02, rise), sc);
    C.rig.setPx(sc * C.dpr);

    // trail for the army
    C.trailT += dt;
    if (C.trailT > 0.05) { C.trailT = 0; C.trail.push({ x: C.pos.x, y: C.pos.y }); if (C.trail.length > 90) C.trail.shift(); }
    const side = C.pos.x < C.W / 2 ? 1 : -1;
    C.army.forEach((f, i) => {
      const tr = C.trail[Math.max(0, C.trail.length - 1 - (i + 1) * 9)] || C.pos;
      const o = OFFS[i] || OFFS[2];
      const fx = clampX(tr.x + side * o[0] * S), fy = clampY(tr.y + o[1] * S);
      const ex = fx - f.x, ey = fy - f.y, dist = Math.hypot(ex, ey);
      const w = dist < 5 ? 0 : Math.min(dist > S * 2.4 ? 640 : 230, dist * 3.2);
      f.vx = damp(f.vx, dist ? ex / dist * w : 0, 6, dt); f.vy = damp(f.vy, dist ? ey / dist * w : 0, 6, dt);
      f.x += f.vx * dt; f.y += f.vy * dt;
      const fsp = Math.hypot(f.vx, f.vy), fwalk = clamp(fsp / 200, 0, 1), frun = clamp((fsp - 250) / 380, 0, 1);
      f.phase += (fsp / (S * f.scale)) * 4.2 * dt;
      f.yaw = damp(f.yaw, fsp > 28 ? clamp(f.vx / 220, -1, 1) * 1.05 : (C.atk ? C.atk.dir * 0.7 : C.yaw * 0.8), 8, dt);
      f.rise = Math.min(1, f.rise + dt / (0.8 + i * 0.25));
      if (f.swingAt > 0) { f.swingAt -= dt; if (f.swingAt <= 0) f.swingT = 0; }
      let fs = null;
      if (f.swingT >= 0) { f.swingT += dt / 0.5; fs = f.swingT; if (f.swingT >= 1) f.swingT = -1; }
      const fscale = S * f.scale * depthScale(f.y);
      f.rig.pose({ t: C.t + i * 1.3, walk: fwalk, run: frun, phase: f.phase, yaw: f.yaw, stance: fs != null || C.mood === "focus" ? "ready" : "idle", swing: fs, headYaw: aim * 0.6 - f.yaw, headPitch: pitch });
      f.rig.root.position.set(wx(f.x), wy(f.y), (f.y / C.H) * 80);
      f.rig.root.scale.set(fscale, fscale * Math.max(0.02, easeOut(f.rise)), fscale);
      f.rig.setPx(fscale * C.dpr);
      f.rig.setRim(rimTarget, Math.min(1, dt * 3));
    });

    // summoned soldiers
    C.minions = C.minions.filter((m) => {
      m.age += dt;
      if (m.age >= m.life) { C.scene.remove(m.rig.root); return false; }
      const up = easeOut(m.age / 0.55), down = m.age > m.life - 0.6 ? (m.age - (m.life - 0.6)) / 0.6 : 0;
      const k = S * 0.62 * depthScale(m.y), yl = Math.max(0.02, up * (1 - down));
      m.rig.pose({ t: C.t + m.x * 0.01, stance: "ready", yaw: clamp((C.cursor.x - m.x) / (C.W * 0.4), -1, 1) * 0.6, headYaw: 0, wave: 0.3 });
      m.rig.root.position.set(wx(m.x), wy(m.y), (m.y / C.H) * 80);
      m.rig.root.scale.set(k, k * yl, k);
      return true;
    });

    // fx
    C.fx = C.fx.filter((f) => f(dt));
    updateSparks(dt);
    if (!isLite() && speed > 120 && Math.random() < dt * 5) burst(C.pos.x, C.pos.y - 4, 1, { speed: 40, size: 8, life: 0.5 });

    // bubble
    if (C.line && C.line.classList.contains("on")) {
      const bx = clamp(C.pos.x, 80, C.W - 80), by = C.pos.y - sc * 1.16 - 8;
      C.line.style.transform = "translate3d(" + Math.round(bx) + "px," + Math.round(Math.max(72, by)) + "px,0) translate(-50%,-100%)";
    }

    // occasional idle line + save position for the next page
    if (now > C.nextIdle && C.mood === "idle" && idleFor > 20) { say(pick(LINES.idle), 3200); C.nextIdle = now + 90000 + Math.random() * 60000; }
    if (now - C.lastSave > 600) {
      C.lastSave = now;
      try { sessionStorage.setItem("sf_s3d_pos", JSON.stringify({ x: C.pos.x / C.W, y: C.pos.y / C.H })); } catch (e) { /* ignore */ }
    }
  }

  function resize() {
    C.dpr = Math.min(window.devicePixelRatio || 1, isLite() ? 1 : 1.5);
    C.W = window.innerWidth; C.H = window.innerHeight;
    C.S = clamp(Math.min(C.W, C.H) * 0.2, 108, 176);
    C.renderer.setPixelRatio(C.dpr);
    C.renderer.setSize(C.W, C.H, false);
    const fov = 30;
    C.camZ = (C.H / 2) / Math.tan(fov / 2 * Math.PI / 180);
    C.camera.fov = fov; C.camera.aspect = C.W / C.H; C.camera.near = C.camZ * 0.35; C.camera.far = C.camZ * 2.2;
    C.camera.position.set(0, 0, C.camZ); C.camera.updateProjectionMatrix();
    if (sp.mat) sp.mat.uniforms.uDpr.value = C.dpr;
    C.pos.x = clampX(C.pos.x); C.pos.y = clampY(C.pos.y);
  }

  function frame(now) {
    C.raf = 0;
    if (!C.on || document.hidden) return;
    if (isLite() && now - C.lastRender < 33) { C.raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.05, (now - C.last) / 1000 || 0.016);
    C.last = now; C.lastRender = now;
    try {
      update(dt, now);
      C.renderer.render(C.scene, C.camera);
    } catch (e) { console.error("shadow3d frame error", e); setEnabled(false, true); return; }
    C.raf = requestAnimationFrame(frame);
  }
  function kick() { if (C.ready && C.on && !C.raf && !document.hidden) { C.last = performance.now(); C.raf = requestAnimationFrame(frame); } }

  function setEnabled(on, silent) {
    C.on = !!on && C.ready;
    document.documentElement.classList.toggle("s3d-off", !C.on);
    if (!silent) { prefs.on = !!on; savePrefs(); }
    const t = document.getElementById("s3dToggle"); if (t) t.checked = C.on;
    if (C.on) kick();
  }

  /* ---------- input ---------- */
  function onMove(e) {
    if (e.pointerType === "touch") return;
    C.cursor.x = e.clientX; C.cursor.y = e.clientY; C.cursor.has = true; C.lastMove = performance.now();
  }
  function onDown(e) {
    if (!C.on || (e.pointerType !== "touch" && e.button !== 0)) return;
    const el = e.target && e.target.closest ? e.target : null;
    if (el && el.closest(IGNORE)) return;
    const x = e.clientX, y = e.clientY;
    C.cursor.x = x; C.cursor.y = y; C.cursor.has = true; C.lastMove = performance.now();
    const sc = C.S * depthScale(C.pos.y);
    if (Math.abs(x - C.pos.x) < sc * 0.32 && y < C.pos.y + 6 && y > C.pos.y - sc * 1.05) { poke(); return; }
    if (el && el.closest(INTERACTIVE)) { nudge(x, y); return; }
    attack(x, y);
  }
  function onDbl(e) {
    if (!C.on) return;
    const el = e.target && e.target.closest ? e.target : null;
    if (el && (el.closest(IGNORE) || el.closest(INTERACTIVE))) return;
    C.atk = null; C.combo = 0;
    summon(e.clientX, e.clientY);
  }

  /* ---------- settings toggles + init ---------- */
  function injectSettings() {
    const pop = document.getElementById("settingsPop");
    if (!pop || document.getElementById("s3dToggle")) return;
    const row = (id, title, sub, on) => {
      const l = document.createElement("label");
      l.className = "set-row";
      l.innerHTML = "<span>" + title + " <small>" + sub + "</small></span><span class=\"switch\"><input type=\"checkbox\" id=\"" + id + "\"" + (on ? " checked" : "") + "><i></i></span>";
      pop.appendChild(l);
      return l.querySelector("input");
    };
    row("s3dToggle", "Shadow companion", "3D warrior that follows your cursor", C.on).addEventListener("change", (e) => setEnabled(e.target.checked));
    row("s3dSfx", "Shadow sounds", "whoosh when he strikes", prefs.sfx).addEventListener("change", (e) => { prefs.sfx = e.target.checked; savePrefs(); });
  }

  function init() {
    try {
      C.canvas = document.createElement("canvas");
      C.canvas.id = "s3dCanvas"; C.canvas.setAttribute("aria-hidden", "true");
      document.body.appendChild(C.canvas);
      C.renderer = new THREE.WebGLRenderer({ canvas: C.canvas, alpha: true, antialias: !coarse, premultipliedAlpha: true, powerPreference: "low-power" });
      C.renderer.setClearColor(0x000000, 0);
    } catch (e) {
      console.warn("shadow3d: WebGL unavailable - keeping the 2D companion", e);
      if (C.canvas && C.canvas.parentNode) C.canvas.parentNode.removeChild(C.canvas);
      return;
    }
    C.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); setEnabled(false, true); });

    const st = document.createElement("style");
    st.textContent =
      "#s3dCanvas{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:45}" +
      ".s3d-line{position:fixed;left:0;top:0;z-index:46;pointer-events:none;padding:7px 13px;border-radius:999px;white-space:nowrap;font-size:.82rem;font-weight:500;color:var(--ink,#eee);background:var(--panel-solid,#1a1530);border:1px solid var(--line,rgba(255,255,255,.14));box-shadow:var(--shadow,0 10px 30px rgba(0,0,0,.4));opacity:0;transition:opacity .25s}" +
      ".s3d-line.on{opacity:1}html.s3d-off #s3dCanvas,html.s3d-off .s3d-line{display:none}" +
      "@media (max-width:760px){.s3d-line{font-size:.74rem;padding:6px 11px}}";
    document.head.appendChild(st);
    C.line = document.createElement("div"); C.line.className = "s3d-line"; C.line.setAttribute("role", "status");
    document.body.appendChild(C.line);

    C.scene = new THREE.Scene();
    C.camera = new THREE.PerspectiveCamera(30, 1, 10, 5000);
    C.accent = C.rimHex = accentHex();
    setInterval(() => { C.accent = accentHex(); }, 1000);
    C.rig = buildRig({ hero: true, kind: "sword", tier: 1, rim: C.rimHex, smoke: isLite() ? 0 : 30 });
    C.scene.add(C.rig.root);
    resize();
    initSparks();

    // start where the last page left him, or arise in the corner
    let restored = false;
    try {
      const s = JSON.parse(sessionStorage.getItem("sf_s3d_pos") || "null");
      if (s && isFinite(s.x) && isFinite(s.y)) { C.pos.x = clampX(s.x * C.W); C.pos.y = clampY(s.y * C.H); restored = true; }
    } catch (e) { /* ignore */ }
    if (!restored) {
      C.pos.x = C.S * 0.7 + 10; C.pos.y = C.H - (C.W < 760 ? 104 : 26); C.enter = 0;
      setTimeout(() => { ring(C.pos.x, C.pos.y, C.S * 1.2, 0.9, null, true); burst(C.pos.x, C.pos.y - 10, 30, { speed: 240 }); }, 200);
    } else C.enter = 1;

    C.ready = true;
    window.addEventListener("resize", resize);
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    document.addEventListener("dblclick", onDbl, { passive: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });
    window.addEventListener("pagehide", () => { try { sessionStorage.setItem("sf_s3d_pos", JSON.stringify({ x: C.pos.x / C.W, y: C.pos.y / C.H })); } catch (e) { /* ignore */ } });

    // take over from the old 2D companion button
    const old = document.getElementById("companion");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    setEnabled(prefs.on, true);
    injectSettings();
    setInterval(refreshArmy, 2500);
    setTimeout(refreshArmy, 900);
  }

  const api = { set: setMood, cheer: cheer, say: say };
  window.Shadow3D = {
    figure: figure, companion: api, setEnabled: setEnabled, refreshArmy: refreshArmy,
    attack: (x, y) => { if (C.on) attack(x, y); }, summon: (x, y) => summon(x, y)
  };
  if (window.SF) window.SF.companion = api;      // same API script.js already calls

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);
})();