// firebase-supabase-shim.v3.js — Firebase-backed shim with aggressive commit + autosave
// - Saves on localStorage writes, on input/blur/change, before tab closes, and every 10s if changed.
// - loadFromCloud() refreshes UI by default.
// - __debugCloud() shows doc size + timestamp.
(async function() {
  if (window.__FIREBASE_SUPA_SHIM__) return;
  window.__FIREBASE_SUPA_SHIM__ = true;

  const [appMod, authMod, fsMod] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js")
  ]);

  const firebaseConfig = {
  "apiKey": "AIzaSyB-iJ_OwpoRVae4WMQN0nQrT_vCbk8PaMg",
  "authDomain": "microgreens-consulting.firebaseapp.com",
  "projectId": "microgreens-consulting",
  "storageBucket": "microgreens-consulting.firebasestorage.app",
  "messagingSenderId": "475533983094",
  "appId": "1:475533983094:web:857445fcc8d5f82a8f4e57",
  "measurementId": "G-FRTY3RJPTT"
};
  const app = appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  try { await authMod.setPersistence(auth, authMod.browserLocalPersistence); } catch (e) { console.warn("persistence", e); }
  const db  = fsMod.getFirestore(app);

  const whoami   = document.getElementById("whoami");
  const statusEl = document.getElementById("status");
  const cloudBar = document.getElementById("cloud-controls");
  const LOCAL_KEY = "microgreens_calc_unified";

  // ---- Helpers for local state
  function collectLocalState() {
    try {
      const single = localStorage.getItem(LOCAL_KEY);
      if (single) return { [LOCAL_KEY]: single };
    } catch (e) {}
    const state = {};
    for (let i=0;i<localStorage.length;i++) {
      const k = localStorage.key(i);
      state[k] = localStorage.getItem(k);
    }
    return state;
  }
  function applyLocalState(state, opts) {
    opts = opts || { reload:false };
    if (!state) return;
    try { localStorage.clear(); } catch (e) {}
    for (const k in state) {
      const v = state[k];
      if (typeof v === "string") localStorage.setItem(k, v);
    }
    if (opts.reload && !sessionStorage.getItem("mg_cloud_applied")) {
      sessionStorage.setItem("mg_cloud_applied", "1");
      try { location.reload(); } catch (e) {}
    }
  }

  // ---- Cloud I/O
  async function saveToCloud() {
    const u = auth.currentUser;
    if (!u) { if (statusEl) statusEl.textContent = "Please sign in first."; return; }
    if (statusEl) statusEl.textContent = "Saving…";
    try {
      await fsMod.setDoc(fsMod.doc(db, "app_state", u.uid), {
        state: collectLocalState(),
        updated_at: fsMod.serverTimestamp()
      }, { merge: true });
      if (statusEl) statusEl.textContent = "Saved to cloud ✔";
    } catch (e) {
      if (statusEl) statusEl.textContent = "Save failed.";
      console.error(e);
    }
  }
  async function loadFromCloud(opts) {
    opts = opts || { reload:true }; // refresh UI by default
    const u = auth.currentUser;
    if (!u) { if (statusEl) statusEl.textContent = "Please sign in first."; return; }
    if (statusEl) statusEl.textContent = "Loading…";
    try {
      const snap = await fsMod.getDoc(fsMod.doc(db, "app_state", u.uid));
      if (snap.exists()) {
        const data = snap.data();
        applyLocalState((data && data.state) || {}, opts);
        if (statusEl) statusEl.textContent = "Loaded cloud data ✔";
      } else {
        if (statusEl) statusEl.textContent = "No cloud save yet. Use “Save to Cloud”.";
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = "Load failed.";
      console.error(e);
    }
  }

  // ---- Autosave infrastructure
  let autosaveEnabled = true;
  let saveTimer = null;
  function scheduleAutosave(delayMs) {
    if (!autosaveEnabled) return;
    if (!auth.currentUser) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveToCloud(); }, Math.max(300, delayMs||1200));
  }

  // Save whenever localStorage changes
  const _setItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function(k, v) { try { _setItem(k, v); } finally { scheduleAutosave(800); } };
  const _remove = localStorage.removeItem.bind(localStorage);
  localStorage.removeItem = function(k) { try { _remove(k); } finally { scheduleAutosave(800); } };
  const _clear = localStorage.clear.bind(localStorage);
  localStorage.clear = function() { try { _clear(); } finally { scheduleAutosave(800); } };

  // Encourage the app to commit field edits: dispatch change/blur after typing
  const perElTimers = new WeakMap();
  function debouncePerElement(el, fn, ms) {
    clearTimeout(perElTimers.get(el));
    const t = setTimeout(fn, ms);
    perElTimers.set(el, t);
  }
  function commitField(el) {
    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    try { el.blur(); } catch (e) {}
  }

  // Save on input/change/blur + Commit
  document.addEventListener('input', function(e) {
    const t = e.target;
    if (!t) return;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) return;
    debouncePerElement(t, function() { commitField(t); scheduleAutosave(900); }, 600);
  }, true);
  document.addEventListener('change', function(e) { scheduleAutosave(400); }, true);
  document.addEventListener('blur',   function(e) { scheduleAutosave(400); }, true);
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const t = e.target;
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) {
        commitField(t);
        scheduleAutosave(400);
      }
    }
  }, true);

  // Periodic safe-guard: save if the big app blob changed
  let lastSnapshot = localStorage.getItem(LOCAL_KEY) || '';
  setInterval(function() {
    if (!auth.currentUser) return;
    const cur = localStorage.getItem(LOCAL_KEY) || '';
    if (cur !== lastSnapshot) { lastSnapshot = cur; saveToCloud(); }
  }, 10000);

  // Save when the tab is going away
  window.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") scheduleAutosave(0); });
  window.addEventListener("pagehide", () => scheduleAutosave(0));
  window.addEventListener("beforeunload", () => scheduleAutosave(0));

  // ---- Gate wiring
  function gateEmail() { return (document.getElementById("gate-email")||{}).value||""; }
  function gatePass()  { return (document.getElementById("gate-password")||{}).value||""; }
  function gateCode()  { return (document.getElementById("gate-passcode")||{}).value||""; }

  async function doSignIn() { await authMod.signInWithEmailAndPassword(auth, gateEmail().trim(), gatePass().trim()); }
  async function doSignUp() {
    if (gateCode().trim() !== "microgreensconsulting") { alert("Incorrect passcode."); return; }
    await authMod.createUserWithEmailAndPassword(auth, gateEmail().trim(), gatePass().trim());
    alert("Account created.");
  }
  async function doSignOut() {
    try { await saveToCloud(); } catch (e) { console.warn("autosave before signout", e); }
    try { await authMod.signOut(auth); } catch (e) { console.error(e); }
  }

  // ---- Public API
  window.saveToCloud = saveToCloud;
  window.loadFromCloud = function() { return loadFromCloud({ reload:true }); };
  window.signIn = doSignIn;
  window.signUp = doSignUp;
  window.signOut = doSignOut;
  window.setAutoSave = function(on) { autosaveEnabled = !!on; console.log("autosave", autosaveEnabled? "ON":"OFF"); };
  window.clearAppLocal = function() { try { localStorage.removeItem(LOCAL_KEY); console.log("Local app state cleared"); } catch (e) { console.warn(e); } };

  // ---- Supabase-shaped shim
  const shim = {
    auth: {
      async getUser() {
        const u = auth.currentUser;
        return { data: { user: u ? { id: u.uid, email: u.email } : null }, error: null };
      },
      async signInWithPassword({ email, password }) {
        await authMod.signInWithEmailAndPassword(auth, email, password);
        return { data: { user: auth.currentUser ? { id: auth.currentUser.uid, email: auth.currentUser.email } : null }, error: null };
      },
      async signUp({ email, password }) {
        await authMod.createUserWithEmailAndPassword(auth, email, password);
        return { data: { user: auth.currentUser ? { id: auth.currentUser.uid, email: auth.currentUser.email } : null }, error: null };
      },
      async signOut() { await doSignOut(); return { error: null }; }
    },
    from(table) {
      if (table !== "app_state") {
        return {
          select: async function() { return { data: null, error: "unsupported table" }; },
          upsert: async function() { return { data: null, error: "unsupported table" }; },
          update: async function() { return { data: null, error: "unsupported table" }; },
          insert: async function() { return { data: null, error: "unsupported table" }; }
        };
      }
      const chain = {
        eq: function() { return this; },
        single: async function() {
          const u = auth.currentUser;
          if (!u) return { data: null, error: "not signed in" };
          const snap = await fsMod.getDoc(fsMod.doc(db, "app_state", u.uid));
          return snap.exists() ? { data: snap.data(), error: null } : { data: null, error: null };
        },
        select: function() { return this; },
        upsert: async function(rows) {
          const u = auth.currentUser;
          if (!u) return { data: null, error: "not signed in" };
          const payload = Array.isArray(rows) ? rows[0] : rows;
          await fsMod.setDoc(fsMod.doc(db, "app_state", u.uid), payload, { merge: true });
          return { data: payload, error: null };
        },
        update: async function(obj) {
          const u = auth.currentUser;
          if (!u) return { data: null, error: "not signed in" };
          await fsMod.setDoc(fsMod.doc(db, "app_state", u.uid), obj, { merge: true });
          return { data: obj, error: null };
        }
      };
      return chain;
    },
    createClient: function() { return shim; }
  };

  try { delete window.supabase; } catch (e) { window.supabase = undefined; }
  window.supabase = shim;
  window.createClient = function() { return shim; };

  // Wire gate buttons (fallback)
  const btnIn  = document.getElementById("gate-signin");
  const btnUp  = document.getElementById("gate-signup");
  if (btnIn && !btnIn.dataset.wiredShim) { btnIn.addEventListener("click", doSignIn); btnIn.dataset.wiredShim = "1"; }
  if (btnUp && !btnUp.dataset.wiredShim) { btnUp.addEventListener("click", doSignUp); btnUp.dataset.wiredShim = "1"; }

  // Reflect auth + one-time autoload
  authMod.onAuthStateChanged(auth, async function(user) {
    document.body.classList.toggle("authed", !!user);
    if (whoami) whoami.textContent = user ? ("Signed in as " + (user.email || "")) : "";
    if (cloudBar) cloudBar.style.display = user ? "flex" : "none";
    if (user && !sessionStorage.getItem("mg_cloud_applied")) {
      try { await loadFromCloud({ reload:true }); } catch (e) { console.error(e); }
    } else if (!user && statusEl) {
      statusEl.textContent = "";
    }
  });

  // Debug helper
  window.__debugCloud = async function() {
    const u = auth.currentUser;
    if (!u) return console.log("Not signed in");
    const snap = await fsMod.getDoc(fsMod.doc(db, "app_state", u.uid));
    if (!snap.exists()) return console.log("No cloud doc");
    const data = snap.data();
    const ts = data.updated_at && data.updated_at.toDate ? data.updated_at.toDate() : null;
    console.log("Cloud size:", JSON.stringify(data.state||{}).length, "updated_at:", ts);
    return data;
  };
})();
