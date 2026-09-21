// ------------------------------------------------------------
// firebase-wrapper.js
// Keeps localStorage and Firestore (users/{uid}) in sync and tells
// script.js when the first sync is finished ("cloud-sync-ready").
//
// Load order in index.html:  Firebase SDK -> firebase-init.js -> orb.js -> fx.js -> script.js -> insights.js -> this file
// ------------------------------------------------------------
(function () {
  // never run twice (the old index.html loaded this file two times)
  if (window.__fbWrapperLoaded) return;
  window.__fbWrapperLoaded = true;

  console.log("firebase-wrapper.js loaded");

  // Only these keys are stored in the cloud
  const SYNC_KEYS = [
    "todos", "routine", "timeSessions", "timerState",
    "currentStatsPeriod", "theme", "username", "settings"
  ];
  const OWNER_KEY = "__dataOwner"; // uid that the data in localStorage belongs to

  window.__firestoreDataLoaded = false;
  window.__cloudSyncError = null;

  // ----------------------------------------------------------
  // helpers
  // ----------------------------------------------------------
  const newId = () => Date.now().toString() + Math.random().toString(36).slice(2, 7);

  // JSON round-trip drops `undefined`, which Firestore refuses to store
  const clean = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

  function ensureStorage() {
    if (window.storage) return;
    window.storage = {
      get: (k, def = null) => {
        try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
        catch { return def; }
      },
      set: (k, v) => {
        try { localStorage.setItem(k, JSON.stringify(v)); }
        catch (e) { console.warn(e); }
      }
    };
  }

  let lastErrorToast = 0;
  function reportSyncError(key, err) {
    console.error("firebase-wrapper: sync error for", key, err);
    window.__cloudSyncError = (err && (err.code || err.message)) || "unknown";
    const now = Date.now();
    if (now - lastErrorToast > 30000 && typeof showToast === "function") {
      lastErrorToast = now;
      showToast("Could not save to the cloud (" + window.__cloudSyncError + "). Saved on this device only.", 5000);
    }
  }

  // ----------------------------------------------------------
  // normalisers
  // ----------------------------------------------------------
  function normalizeTodo(item) {
    const id = item && item.id ? String(item.id) : newId();
    const text = (item && (item.text || item.title || item.name)) || "";
    const completed = !!(item && item.completed);
    const createdAt = (item && (item.createdAt || item.created_at)) || new Date().toISOString();
    let completedAt = (item && (item.completedAt || item.completed_at)) || null;
    if (completed && !completedAt) completedAt = new Date().toISOString();
    return { id, text, completed, createdAt, completedAt };
  }

  // Only the keys that are PRESENT are returned, so missing keys never
  // overwrite local data with defaults.
  function normalizeData(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;

    if (Array.isArray(raw.todos)) {
      out.todos = raw.todos
        .map(t => (t && typeof t === "object") ? normalizeTodo(t) : normalizeTodo({ text: String(t) }))
        .filter(t => t.text);
    }

    if (Array.isArray(raw.routine)) {
      out.routine = raw.routine.map(r => ({
        id: r && r.id ? String(r.id) : newId(),
        time: (r && (r.time || r.t)) || "",
        activity: (r && (r.activity || r.name)) || ""
      }));
    }

    if (Array.isArray(raw.timeSessions)) {
      out.timeSessions = raw.timeSessions.map(s => ({
        date: (s && (s.date || s.createdAt)) || new Date().toISOString(),
        duration: Number(s && s.duration) || 0,
        type: (s && s.type) || "study",
        task: (s && (s.task || s.subject)) || null
      }));
    }

    if (raw.timerState && typeof raw.timerState === "object") {
      out.timerState = {
        seconds: Number(raw.timerState.seconds) || 0,
        isRunning: !!raw.timerState.isRunning,
        isBreak: !!raw.timerState.isBreak,
        currentTask: raw.timerState.currentTask || "",
        startTime: raw.timerState.startTime || null
      };
    }

    if (typeof raw.currentStatsPeriod === "string") out.currentStatsPeriod = raw.currentStatsPeriod;
    if (typeof raw.theme === "string") out.theme = raw.theme;
    if (raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings)) out.settings = raw.settings;
    if (typeof raw.username === "string" && raw.username.trim()) out.username = raw.username.trim();
    return out;
  }

  function gatherLocal() {
    const out = {};
    SYNC_KEYS.forEach(k => {
      try {
        const v = localStorage.getItem(k);
        if (v !== null) out[k] = JSON.parse(v);
      } catch { /* ignore broken value */ }
    });
    return out;
  }

  function applyToLocal(norm) {
    Object.keys(norm).forEach(k => {
      if (!SYNC_KEYS.includes(k)) return;
      try {
        if (k === "timerState") {
          // Never take over a timer that may be running on another device.
          if (localStorage.getItem("timerState") !== null) return;
          norm.timerState = Object.assign({}, norm.timerState, { isRunning: false, seconds: 0, startTime: null });
        }
        localStorage.setItem(k, JSON.stringify(norm[k]));
      } catch (e) {
        console.warn("firebase-wrapper: could not store", k, e);
      }
    });
  }

  // ----------------------------------------------------------
  // storage wrapping: every storage.set(key, value) also goes to Firestore
  // ----------------------------------------------------------
  function wrapStorage(docRef) {
    ensureStorage();
    const s = window.storage;
    s.__docRef = docRef;              // can be null (signed out / offline mode)
    if (s.__wrapped) return;          // already wrapped - only the target changed
    s.__wrapped = true;

    const originalSet = s.set.bind(s);
    s.set = function (key, value) {
      originalSet(key, value);        // always save locally first

      const ref = s.__docRef;
      if (!ref || !SYNC_KEYS.includes(key)) return;

      try {
        let v = clean(value);
        if (key === "todos" && Array.isArray(v)) v = v.map(normalizeTodo);
        ref.set({ [key]: v }, { merge: true }).catch(err => reportSyncError(key, err));
      } catch (err) {
        reportSyncError(key, err);
      }
    };
    console.log("firebase-wrapper: storage wrapped");
  }

  function finish() {
    window.__firestoreDataLoaded = true;
    // bubbles:true so BOTH document and window listeners receive it
    document.dispatchEvent(new Event("cloud-sync-ready", { bubbles: true }));
  }

  // ----------------------------------------------------------
  // main
  // ----------------------------------------------------------
  function start() {
    ensureStorage();

    if (typeof firebase === "undefined" || !firebase.apps || !firebase.apps.length) {
      console.error("firebase-wrapper: Firebase is not initialised - local-only mode");
      window.__cloudSyncError = "firebase-unavailable";
      wrapStorage(null);
      finish();
      return;
    }

    const auth = firebase.auth();
    const db = firebase.firestore();

    auth.onAuthStateChanged(async (user) => {
      if (!user) {
        console.log("firebase-wrapper: signed out");
        wrapStorage(null);
        finish();
        return;
      }

      const docRef = db.collection("users").doc(user.uid);

      try {
        // 1) Data in this browser belongs to a DIFFERENT account? Drop it,
        //    otherwise it would leak into (and be uploaded to) this account.
        const owner = localStorage.getItem(OWNER_KEY);
        if (owner && owner !== user.uid) {
          SYNC_KEYS.forEach(k => localStorage.removeItem(k));
        }

        // 2) Read the cloud copy
        const snap = await docRef.get();
        const remote = snap.exists ? (snap.data() || {}) : {};
        const hasRemoteData = ["todos", "routine", "timeSessions"].some(
          k => Array.isArray(remote[k]) && remote[k].length > 0
        );

        const writes = {};

        if (hasRemoteData) {
          // cloud wins -> copy it into localStorage
          applyToLocal(normalizeData(remote));
        } else {
          // first login (or empty account) -> upload what was created as a guest
          const local = normalizeData(gatherLocal());
          Object.keys(local).forEach(k => {
            const v = local[k];
            if (v == null) return;
            if (Array.isArray(v) && v.length === 0) return;
            writes[k] = v;
          });
        }

        // 3) username: cloud value -> Firebase displayName -> e-mail prefix
        const remoteName = typeof remote.username === "string" && remote.username.trim() ? remote.username.trim() : "";
        const name = remoteName || user.displayName || (user.email || "").split("@")[0] || "User";
        localStorage.setItem("username", JSON.stringify(name));
        if (!remoteName) writes.username = name;

        const payload = clean(writes);   // plain JSON only (no undefined)
        if (!snap.exists) payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();

        if (Object.keys(payload).length > 0) {
          await docRef.set(payload, { merge: true });
        }

        localStorage.setItem(OWNER_KEY, user.uid);
        wrapStorage(docRef);
        window.__cloudSyncError = null;
      } catch (err) {
        console.error("firebase-wrapper: load/migrate error", err);
        window.__cloudSyncError = (err && (err.code || err.message)) || "sync-failed";
        wrapStorage(null);            // keep working locally
      }

      finish();
    });

    console.log("firebase-wrapper: initialized");
  }

  start();
})();