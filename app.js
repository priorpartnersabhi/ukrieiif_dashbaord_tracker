(() => {
  const STATUS_CYCLE = ["not_started", "in_progress", "data_not_available", "completed"];
  const STATUS_LABEL = {
    not_started: "Not started",
    in_progress: "In progress",
    data_not_available: "Data not available",
    completed: "Completed",
  };
  const STORAGE_KEY = "placeplus_tracker_session";

  const supabase = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
  );

  const $ = (id) => document.getElementById(id);
  const el = {
    loginView: $("login-view"),
    appView: $("app-view"),
    topbarRight: $("topbar-right"),
    loginForm: $("login-form"),
    nameInput: $("name-input"),
    passwordInput: $("password-input"),
    loginBtn: $("login-btn"),
    loginMessage: $("login-message"),
    userName: $("user-name"),
    signOutBtn: $("sign-out-btn"),
    addBtn: $("add-btn"),
    tableBody: $("dashboards-body"),
    emptyState: $("empty-state"),
    loadingState: $("loading-state"),
    modal: $("modal"),
    modalTitle: $("modal-title"),
    form: $("dashboard-form"),
    formName: $("form-name"),
    formTheme: $("form-theme"),
    formDataSource: $("form-data-source"),
    formNotes: $("form-notes"),
    saveBtn: $("save-btn"),
  };

  let editingId = null;
  let cachedRows = [];
  let cachedVotes = [];
  let realtimeChannel = null;
  let currentUser = null; // { name: string }

  // -------- Session --------
  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.name && parsed.signedIn) return parsed;
    } catch {}
    return null;
  }
  function saveSession(name) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, signedIn: true }));
  }
  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function init() {
    const session = loadSession();
    if (session) {
      currentUser = { name: session.name };
      showApp();
    } else {
      showLogin();
    }
  }

  function showApp() {
    el.loginView.classList.add("hidden");
    el.appView.classList.remove("hidden");
    el.topbarRight.classList.remove("hidden");
    el.userName.textContent = currentUser.name;
    loadAll();
    subscribeRealtime();
  }

  function showLogin() {
    el.appView.classList.add("hidden");
    el.loginView.classList.remove("hidden");
    el.topbarRight.classList.add("hidden");
    unsubscribeRealtime();
    el.nameInput.focus();
  }

  el.loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = el.nameInput.value.trim();
    const password = el.passwordInput.value;

    if (!name) {
      setLoginMessage("Please enter your name.", "error");
      return;
    }
    if (password !== window.SITE_PASSWORD) {
      setLoginMessage("Wrong site password.", "error");
      return;
    }

    currentUser = { name };
    saveSession(name);
    setLoginMessage("", "");
    el.passwordInput.value = "";
    showApp();
  });

  el.signOutBtn.addEventListener("click", () => {
    clearSession();
    currentUser = null;
    cachedRows = [];
    cachedVotes = [];
    renderRows();
    showLogin();
  });

  function setLoginMessage(text, kind) {
    el.loginMessage.textContent = text;
    el.loginMessage.className = "message " + (kind || "");
  }

  // -------- Data loading --------
  async function loadAll() {
    el.loadingState.classList.remove("hidden");
    el.emptyState.classList.add("hidden");

    const [dashboardsRes, votesRes] = await Promise.all([
      supabase.from("dashboards").select("*").order("created_at", { ascending: true }),
      supabase.from("votes").select("*"),
    ]);

    el.loadingState.classList.add("hidden");

    if (dashboardsRes.error) {
      el.tableBody.innerHTML = `<tr><td colspan="8" class="empty">Error loading dashboards: ${escapeHtml(dashboardsRes.error.message)}</td></tr>`;
      return;
    }
    if (votesRes.error) {
      console.error("[votes] load error:", votesRes.error);
    }

    cachedRows = dashboardsRes.data || [];
    cachedVotes = votesRes.data || [];
    renderRows();
  }

  function votesFor(dashboardId) {
    return cachedVotes.filter((v) => v.dashboard_id === dashboardId);
  }
  function userHasVoted(dashboardId) {
    if (!currentUser) return false;
    return cachedVotes.some(
      (v) => v.dashboard_id === dashboardId && v.user_name === currentUser.name
    );
  }

  function renderRows() {
    if (cachedRows.length === 0) {
      el.tableBody.innerHTML = "";
      el.emptyState.classList.remove("hidden");
      return;
    }
    el.emptyState.classList.add("hidden");
    el.tableBody.innerHTML = cachedRows.map(rowHtml).join("");
  }

  function rowHtml(row) {
    const sourceCell = row.data_source_url
      ? `<a href="${escapeAttr(row.data_source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(truncate(row.data_source_url, 50))}</a>`
      : `<span class="subtle">—</span>`;

    const voteCount = votesFor(row.id).length;
    const voted = userHasVoted(row.id);

    return `
      <tr data-id="${row.id}">
        <td class="col-name">${escapeHtml(row.name || "")}</td>
        <td>${escapeHtml(row.theme || "") || '<span class="subtle">—</span>'}</td>
        <td class="col-source">${sourceCell}</td>
        <td class="col-notes">${escapeHtml(row.notes || "") || '<span class="subtle">—</span>'}</td>
        <td class="col-status">
          <button class="status-btn" data-action="cycle-status" title="${STATUS_LABEL[row.status]} — click to change">
            <span class="status-icon status-${row.status}" aria-label="${STATUS_LABEL[row.status]}"></span>
          </button>
        </td>
        <td class="col-votes">
          <button class="vote-btn ${voted ? "voted" : ""}" data-action="toggle-vote" title="${voted ? "Remove your vote" : "Vote for this dashboard"}">
            <span class="vote-arrow" aria-hidden="true">▲</span>
            <span class="vote-count">${voteCount}</span>
          </button>
        </td>
        <td class="col-author">${row.created_by_name ? escapeHtml(row.created_by_name) : '<span class="subtle">—</span>'}</td>
        <td class="col-actions">
          <button class="btn-icon" data-action="edit" title="Edit">Edit</button>
          <button class="btn-danger" data-action="delete" title="Delete">Delete</button>
        </td>
      </tr>
    `;
  }

  // -------- Row actions --------
  el.tableBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const tr = btn.closest("tr");
    const id = tr?.dataset.id;
    if (!id) return;

    const action = btn.dataset.action;
    if (action === "cycle-status") return cycleStatus(id);
    if (action === "toggle-vote") return toggleVote(id);
    if (action === "edit") return openModalForEdit(id);
    if (action === "delete") return deleteRow(id);
  });

  async function cycleStatus(id) {
    const row = cachedRows.find((r) => r.id === id);
    if (!row) return;
    const idx = STATUS_CYCLE.indexOf(row.status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];

    row.status = next;
    renderRows();

    const { error } = await supabase.from("dashboards").update({ status: next }).eq("id", id);
    if (error) {
      alert("Failed to update status: " + error.message);
      loadAll();
    }
  }

  async function toggleVote(dashboardId) {
    if (!currentUser) return;
    const voted = userHasVoted(dashboardId);

    if (voted) {
      // optimistic remove
      cachedVotes = cachedVotes.filter(
        (v) => !(v.dashboard_id === dashboardId && v.user_name === currentUser.name)
      );
      renderRows();
      const { error } = await supabase
        .from("votes")
        .delete()
        .eq("dashboard_id", dashboardId)
        .eq("user_name", currentUser.name);
      if (error) {
        alert("Failed to remove vote: " + error.message);
        loadAll();
      }
    } else {
      // optimistic add
      cachedVotes.push({
        dashboard_id: dashboardId,
        user_name: currentUser.name,
        created_at: new Date().toISOString(),
      });
      renderRows();
      const { error } = await supabase
        .from("votes")
        .insert({ dashboard_id: dashboardId, user_name: currentUser.name });
      if (error) {
        alert("Failed to save vote: " + error.message);
        loadAll();
      }
    }
  }

  async function deleteRow(id) {
    const row = cachedRows.find((r) => r.id === id);
    if (!row) return;
    if (!confirm(`Delete "${row.name}"?`)) return;

    const { error } = await supabase.from("dashboards").delete().eq("id", id);
    if (error) {
      alert("Failed to delete: " + error.message);
      return;
    }
    cachedRows = cachedRows.filter((r) => r.id !== id);
    cachedVotes = cachedVotes.filter((v) => v.dashboard_id !== id);
    renderRows();
  }

  // -------- Modal + form --------
  el.addBtn.addEventListener("click", () => openModalForAdd());

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", closeModal);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.modal.classList.contains("hidden")) closeModal();
  });

  function openModalForAdd() {
    editingId = null;
    el.modalTitle.textContent = "Add dashboard";
    el.form.reset();
    el.modal.classList.remove("hidden");
    el.formName.focus();
  }

  function openModalForEdit(id) {
    const row = cachedRows.find((r) => r.id === id);
    if (!row) return;
    editingId = id;
    el.modalTitle.textContent = "Edit dashboard";
    el.formName.value = row.name || "";
    el.formTheme.value = row.theme || "";
    el.formDataSource.value = row.data_source_url || "";
    el.formNotes.value = row.notes || "";
    el.modal.classList.remove("hidden");
    el.formName.focus();
  }

  function closeModal() {
    el.modal.classList.add("hidden");
    editingId = null;
  }

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: el.formName.value.trim(),
      theme: el.formTheme.value.trim() || null,
      data_source_url: el.formDataSource.value.trim() || null,
      notes: el.formNotes.value.trim() || null,
    };
    if (!payload.name) return;

    el.saveBtn.disabled = true;

    let error;
    if (editingId) {
      ({ error } = await supabase.from("dashboards").update(payload).eq("id", editingId));
    } else {
      ({ error } = await supabase.from("dashboards").insert({
        ...payload,
        status: "not_started",
        created_by_name: currentUser?.name || null,
      }));
    }

    el.saveBtn.disabled = false;

    if (error) {
      alert("Failed to save: " + error.message);
      return;
    }
    closeModal();
    loadAll();
  });

  // -------- Real-time --------
  function subscribeRealtime() {
    if (realtimeChannel) return;
    realtimeChannel = supabase
      .channel("tracker-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "dashboards" }, () => loadAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, () => loadAll())
      .subscribe();
  }

  function unsubscribeRealtime() {
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  }

  // -------- Utilities --------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  // Boot
  if (!window.SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY.startsWith("PASTE_")) {
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif">' +
      '<h2>Missing Supabase anon key</h2>' +
      '<p>Edit <code>config.js</code> and paste your anon/public key.</p>' +
      '</div>';
    return;
  }
  if (!window.SITE_PASSWORD) {
    document.body.innerHTML =
      '<div style="padding:40px;font-family:sans-serif">' +
      '<h2>Missing site password</h2>' +
      '<p>Edit <code>config.js</code> and set <code>window.SITE_PASSWORD</code>.</p>' +
      '</div>';
    return;
  }
  init();
})();
