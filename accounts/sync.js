const config = window.magicDashAccountConfig;
if (config?.url && config.publishableKey) {
  startAccounts().catch(() => { accountPhase = "unavailable"; render(); });
}

async function startAccounts() {
  const accountButton = document.querySelector("#account-button");
  const menu = document.querySelector("#account-menu");
  const manage = document.querySelector("#account-manage");
  const identity = document.querySelector("#account-identity");
  const logout = document.querySelector("#account-logout");
  const deleteAccount = document.querySelector("#account-delete");
  const dialog = document.querySelector("#account-dialog");
  const form = document.querySelector("#account-form");
  const title = document.querySelector("#account-title");
  const fields = document.querySelector("#account-fields");
  const actions = document.querySelector("#account-actions");
  const status = document.querySelector("#account-status");
  const close = document.querySelector("#account-close");
  const empty = emptyAccountState;
  const readLocal = () => {
    try {
      return {...empty(), ...JSON.parse(localStorage.getItem("mana-radar-v1")),
        watchlist: JSON.parse(localStorage.getItem("magic-dash-local-watches")) || []};
    }
    catch { return empty(); }
  };
  const hasLocalData = data =>
    data.decks.length || data.customEvents.length || data.playEvents.length || data.watchlist.length || Object.keys(data.snapshots).length;
  const table = "magic_dash_accounts";
  const redirectTo = new URL(location.pathname, location.origin).href;
  let client;
  let active;
  let mode = "signin";
  let authReady = false;
  let busy = false;
  let accountMessage = "";

  function action(label, callback, submit = false) {
    const button = document.createElement("button");
    button.className = "button" + (submit ? " primary" : "");
    button.type = submit ? "submit" : "button";
    button.textContent = label;
    if (callback) button.addEventListener("click", callback);
    actions.append(button);
  }

  function field(label, name, type, autocomplete) {
    const wrapper = document.createElement("label");
    const input = document.createElement("input");
    input.type = type;
    input.name = name;
    input.autocomplete = autocomplete;
    input.required = true;
    if (name === "name") input.maxLength = 100;
    if (["signup","password"].includes(mode) && type === "password") input.minLength = 8;
    wrapper.append(label, input);
    fields.append(wrapper);
  }

  function setStatus(message) {
    accountMessage = message;
    status.textContent = message;
    drawHeader();
  }

  function drawHeader() {
    const user = active?.user;
    menu.hidden = !user;
    accountButton.hidden = Boolean(user);
    if (!user) menu.open = false;
    identity.textContent = user ? "Logged in as " + (user.user_metadata?.name?.trim?.() || user.email) : "";
    identity.title = identity.textContent;
  }

  function showMode(next) {
    mode = next;
    setStatus("");
    draw();
    (fields.querySelector("input") || close).focus();
  }

  function draw() {
    fields.replaceChildren();
    actions.replaceChildren();
    drawHeader();
    title.textContent = active && !["password","delete"].includes(mode) ? "Your account" : {
      delete: "Delete account",
      signin: accountIntent?.reason ? "Sign in to " + accountIntent.reason : "Sign in",
      signup: "Create account", reset: "Reset password", password: "Set a new password"
    }[mode];
    if (!authReady) {
      status.textContent = accountMessage || "Connecting to accounts…";
      return;
    }
    if (mode === "delete") {
      const warning = document.createElement("p");
      warning.textContent = "This permanently deletes your account, events, decks, match logs, and saved watchlist.";
      fields.append(warning);
      field("Current password", "password", "password", "current-password");
      action("Permanently delete account", null, true);
      action("Cancel", () => { if (!busy) showMode("signin"); });
    } else if (mode === "password") {
      field("New password", "password", "password", "new-password");
      action("Set password", null, true);
    } else if (active) {
      const identity = document.createElement("p");
      identity.textContent = [active.user.user_metadata?.name, active.user.email].filter(Boolean).join(" · ");
      fields.append(identity);
      if (active.failed) action("Retry sync", () => retry(active));
      if (active.conflict) {
        action("Download unsynced data", () => download(active.record.data));
        action("Discard this device’s changes and reload", () => load(active, true));
      }
      if (active.ready && !active.conflict && hasLocalData(readLocal())) {
        action("Import this browser’s data", importLocal);
      }
    } else {
      if (mode === "signup") field("Name", "name", "text", "name");
      field("Email", "email", "email", "email");
      if (mode !== "reset") field("Password", "password", "password", mode === "signup" ? "new-password" : "current-password");
      action({signin: "Sign in", signup: "Create account", reset: "Send reset email"}[mode], null, true);
      if (mode === "signin") {
        action("Create account", () => showMode("signup"));
        action("Forgot password?", () => showMode("reset"));
      } else action("Back to sign in", () => showMode("signin"));
    }
    status.textContent = accountMessage;
  }

  function download(data) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type: "application/json"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = "magic-dash-unsynced-data.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importLocal() {
    const profile = active;
    const local = readLocal();
    const current = profile.record.data;
    const addMissing = (existing, incoming, key) => {
      const known = new Set(existing.map(item => item[key]));
      return [...existing, ...incoming.filter(item => !known.has(item[key]))];
    };
    const playEvents = current.playEvents.map(item => {
      const saved = local.playEvents.find(event => event.id === item.id);
      return saved ? {...item, matches: addMissing(item.matches, saved.matches, "id")} : item;
    });
    const snapshots = {...current.snapshots};
    for (const format of Object.keys(local.snapshots)) {
      snapshots[format] = addMissing(current.snapshots[format] || [], local.snapshots[format], "asOf");
    }
    const merged = {
      decks: addMissing(current.decks, local.decks, "id"),
      customEvents: addMissing(current.customEvents, local.customEvents, "id"),
      playEvents: addMissing(playEvents, local.playEvents, "id"),
      watchlist: window.MagicDashTools.mergeWatchlists(current.watchlist, local.watchlist),
      snapshots
    };
    if (JSON.stringify(merged) === JSON.stringify(current)) {
      setStatus("This browser has no additional records to import.");
      return;
    }
    try {
      save(profile, merged);
      replaceAccountState(merged);
    } catch (error) { setStatus(error.message); }
  }

  function store(profile, record) {
    localStorage.setItem(profile.key, JSON.stringify(record));
    profile.record = record;
  }

  function save(profile, data) {
    if (active !== profile || !profile.ready || mode === "delete") throw Error("Your account is unavailable for editing.");
    if (profile.conflict) throw Error("Open Account to resolve the sync conflict before making changes.");
    try { store(profile, {...profile.record, data, dirty: true}); }
    catch { throw Error("This browser could not save your changes."); }
    void sync(profile);
  }

  async function sync(profile) {
    if (active !== profile || profile.saving || !profile.ready || profile.conflict || !profile.record.dirty) return;
    profile.saving = true;
    profile.failed = false;
    setStatus("Saving to your account…");
    setAccountSync("Saving to your account…");
    const sent = profile.record;
    try {
      const revision = sent.revision + 1;
      const request = sent.revision
        ? client.from(table).update({revision, data: sent.data}).eq("user_id", profile.user.id).eq("revision", sent.revision)
        : client.from(table).insert({user_id: profile.user.id, revision, data: sent.data});
      const {data, error} = await request.select("revision").maybeSingle();
      if (active !== profile) return;
      if (error?.code === "23505" || (!error && !data)) {
        profile.conflict = true;
        setAccountSync("Another device saved changes. This device has an unsynced copy.", "Resolve sync", openAccount);
        setStatus("Another device saved changes. Download this device’s unsynced data before discarding it and reloading.");
      } else {
        if (error) throw error;
        const dirty = profile.record !== sent;
        store(profile, {...profile.record, revision: data.revision, dirty});
        setStatus(dirty ? "Saving to your account…" : "Saved to your account.");
        setAccountSync(dirty ? "Saving to your account…" : "Saved to your account.");
      }
    } catch {
      if (active === profile) {
        profile.failed = true;
        setStatus("Changes are saved in this browser. Account sync failed.");
        setAccountSync("Saved on this device. Account sync failed.", "Retry sync", () => retry(profile));
      }
    } finally {
      profile.saving = false;
      if (active === profile) {
        if (profile.failed || profile.conflict) draw();
        else void sync(profile);
      }
    }
  }

  async function load(profile, discard = false) {
    if (profile.loading || profile.saving) return;
    profile.loading = true;
    profile.failed = false;
    if (!profile.ready) {
      accountPhase = "loading";
      setAccountSync();
      render();
    }
    setStatus("Loading your account data…");
    try {
      const {data, error} = await client.from(table).select("revision,data").eq("user_id", profile.user.id).maybeSingle();
      if (active !== profile) return;
      if (error) throw error;
      const revision = data?.revision || 0;
      const cached = profile.record;
      if (!discard && cached?.dirty) {
        profile.conflict = cached.revision !== revision;
      } else {
        store(profile, {revision, data: {...empty(), ...data?.data}, dirty: false});
        profile.conflict = false;
      }
      profile.ready = true;
      accountPhase = "ready";
      replaceAccountState(profile.record.data);
      setStatus(profile.conflict ? "Another device saved changes. Download this device’s unsynced data before discarding it and reloading." :
        profile.record.dirty ? "Saving to your account…" : "Account data is up to date.");
      if (profile.conflict) setAccountSync("Another device saved changes. This device has an unsynced copy.", "Resolve sync", openAccount);
      else if (profile.record.dirty) void sync(profile);
      else if (discard) setAccountSync("Account data reloaded.");
      if (accountIntent && !profile.conflict && mode !== "password") {
        const {resume} = accountIntent;
        accountIntent = undefined;
        if (dialog.open) dialog.close();
        queueMicrotask(resume);
      }
    } catch {
      if (active !== profile) return;
      profile.failed = true;
      accountPhase = "unavailable";
      render();
      setStatus("Could not load your account data. Retry sync to reconnect.");
      setAccountSync("Your account data could not load.", "Retry sync", () => retry(profile));
    } finally {
      profile.loading = false;
      if (active === profile) draw();
    }
  }

  function retry(profile) {
    if (!profile.ready) void load(profile);
    else void sync(profile).then(() => { if (active === profile) draw(); });
  }

  function switchUser(user) {
    if (active?.user.id === user?.id && accountPhase !== "checking") return;
    if (active?.record && !active.record.dirty) {
      try { localStorage.removeItem(active.key); } catch {}
    }
    if (!user?.email_confirmed_at) {
      active = undefined;
      accountPhase = "signed-out";
      setAccountSync();
      connectAccountStorage(undefined);
      replaceAccountState(empty());
      setStatus("");
      mode = "signin";
      return;
    }
    const profile = {user, key: "magic-dash-account:" + user.id};
    try {
      profile.record = JSON.parse(localStorage.getItem(profile.key));
      if (profile.record) profile.record.data = {...empty(), ...profile.record.data};
    } catch {}
    active = profile;
    accountPhase = "loading";
    setAccountSync();
    connectAccountStorage({
      id: user.id,
      canEdit: () => profile.ready && !profile.conflict && mode !== "delete",
      save: data => save(profile, data)
    });
    replaceAccountState(empty());
    void load(profile);
  }

  async function submitAuth(request, success) {
    if (busy) return;
    busy = true;
    setStatus("Please wait…");
    try {
      const {error} = await request();
      if (error) throw error;
      success?.();
    } catch (error) {
      setStatus(error.message || "Could not connect. Please try again.");
    } finally {
      busy = false;
      form.elements.password && (form.elements.password.value = "");
    }
  }

  accountButton.hidden = false;
  function openAccount() {
    menu.open = false;
    draw();
    if (!dialog.open) dialog.showModal();
    (fields.querySelector("input") || close).focus();
  }
  accountButton.addEventListener("click", openAccount);
  manage.addEventListener("click", openAccount);
  document.addEventListener("click", event => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
  logout.addEventListener("click", () => {
    menu.open = false;
    void submitAuth(() => client.auth.signOut({scope: "local"}), () => {
      switchUser(undefined);
      accountButton.focus();
    }).then(() => { if (active) openAccount(); });
  });
  deleteAccount.addEventListener("click", () => {
    if (busy) return;
    openAccount();
    showMode("delete");
  });
  dialog.addEventListener("close", () => {
    accountIntent = undefined;
    if (mode === "delete" && !busy) mode = "signin";
    if (active && document.activeElement === document.body) menu.querySelector("summary").focus();
  });
  dialog.addEventListener("cancel", event => { if (busy && mode === "delete") event.preventDefault(); });
  close.addEventListener("click", () => { if (!busy || mode !== "delete") dialog.close(); });
  form.addEventListener("submit", event => {
    event.preventDefault();
    const {email, password, name} = Object.fromEntries(new FormData(form));
    if (mode === "delete" && active) {
      const profile = active;
      void submitAuth(async () => {
        const result = await client.functions.invoke("magic-dash-delete-account", {body: {password}});
        if (result.error || !result.data?.deleted) {
          const details = await result.error?.context?.json?.().catch(() => null);
          throw Error(details?.error || "Could not delete your account. Please try again.");
        }
        try {
          localStorage.removeItem(profile.key);
          localStorage.removeItem("magic-dash-scanner:" + profile.user.id);
        } catch {}
        await client.auth.signOut({scope: "local"}).catch(() => {});
        if (active === profile) switchUser(undefined);
        dialog.close();
        announce("Your Magic Dash account was deleted.");
        return {};
      });
    } else if (mode === "signup") {
      void submitAuth(() => client.auth.signUp({email, password, options: {data: {name: name.trim()}, emailRedirectTo: redirectTo}}),
        () => setStatus("Check your inbox for the link to verify your email."));
    } else if (mode === "reset") {
      void submitAuth(() => client.auth.resetPasswordForEmail(email, {redirectTo}),
        () => setStatus("If that address has an account, check your inbox for a reset link."));
    } else if (mode === "password") {
      void submitAuth(() => client.auth.updateUser({password}), () => {
        showMode("signin");
        setStatus("Password updated.");
      });
    } else void submitAuth(() => client.auth.signInWithPassword({email, password}));
  });
  window.addEventListener("online", () => { if (active) retry(active); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && active?.ready && active.record.dirty && !active.conflict) retry(active);
  });

  try {
    const {createClient} = await import("https://esm.sh/@supabase/supabase-js@2.49.4?bundle");
    client = createClient(config.url, config.publishableKey);
    client.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        const sameUser = authReady && active?.user.id === session?.user.id;
        authReady = true;
        switchUser(session?.user);
        if (event === "PASSWORD_RECOVERY") {
          if (!dialog.open) dialog.showModal();
          showMode("password");
        } else if (!sameUser) {
          draw();
          if (dialog.open) (fields.querySelector("input") || close).focus();
        }
      }, 0);
    });
  } catch {
    accountPhase = "unavailable";
    render();
    setStatus("Accounts could not connect. Reload the page to try again.");
  }
}
