const state = {
  selectedModel: null,
  compareModels: [],
  terms: {},
  lastTerms: [],
  editingTerm: null,
  authenticated: sessionStorage.getItem("bom-authenticated") === "true",
  pendingTab: null,
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function debounce(fn, wait = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s\-_./\\()（）[\]{}]+/g, "");
}

function customerModel(model) {
  const match = String(model.name || "").match(/\(([^()]+)\)(?:\.[^.]+)?$/);
  return match ? match[1].trim() : "";
}

function modelFromBomName(model) {
  const base = String(model.name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/\([^()]+\)$/, "")
    .trim();
  const withoutCategory = base.replace(/^[\u4e00-\u9fff]+[-_ ]*/, "").trim();
  return withoutCategory || model.model;
}

function modelLabel(model) {
  const customer = customerModel(model);
  if (!customer) return model.model;
  const productModel = normalizeText(customer) === normalizeText(model.model) ? modelFromBomName(model) : model.model;
  return `${productModel}(${customer})`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlight(value, terms) {
  let html = escapeHtml(value);
  const sorted = [...new Set(terms.filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const term of sorted) {
    const safe = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(safe, "gi"), (m) => `<span class="match">${m}</span>`);
  }
  return html;
}

function switchTab(name) {
  if (["terminology", "database", "settings"].includes(name) && !state.authenticated) {
    state.pendingTab = name;
    openAuthModal();
    return;
  }
  document.querySelectorAll(".tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === name));
}

function openAuthModal() {
  $("authError").textContent = "";
  $("authModal").hidden = false;
  $("authUser").value = $("authUser").value || "duynk90";
  $("authPass").value = "";
  $("authPass").focus();
}

function closeAuthModal() {
  $("authModal").hidden = true;
  state.pendingTab = null;
}

async function loginProtectedTabs() {
  const data = await api("/api/auth", {
    method: "POST",
    body: JSON.stringify({ username: $("authUser").value.trim(), password: $("authPass").value }),
  });
  if (!data.ok) {
    $("authError").textContent = "Tài khoản hoặc mật khẩu chưa đúng.";
    return;
  }
  state.authenticated = true;
  sessionStorage.setItem("bom-authenticated", "true");
  const target = state.pendingTab || "terminology";
  closeAuthModal();
  switchTab(target);
}

async function loadStatus() {
  const status = await api("/api/status");
  $("metricFiles").textContent = status.files;
  $("metricRows").textContent = status.rows;
  const idx = status.index;
  const statusLabels = {
    Idle: "Đang chờ",
    "Index complete": "Đã đọc xong dữ liệu",
    "Scanning BOM folder": "Đang quét thư mục BOM",
  };
  const message = idx.message || "Idle";
  $("statusText").textContent = statusLabels[message] || message.replace("Indexing", "Đang đọc").replace("changed BOM file(s)", "file BOM thay đổi");
  $("statusMeta").textContent = `${status.files} file, ${status.rows} dòng`;
  $("statusDot").classList.toggle("busy", idx.running);
  $("metricProgress").textContent = idx.running ? `${idx.indexed}/${idx.total}` : "Đang chờ";
  $("indexErrors").textContent = idx.errors?.length ? idx.errors.join("\n") : "";
}

async function loadSettings() {
  const settings = await api("/api/settings");
  $("bomFolder").value = settings.bom_folder || "";
}

async function searchModels(input, target, onPick) {
  const q = input.value.trim();
  if (!q) {
    target.innerHTML = "";
    return;
  }
  const models = await api(`/api/models?q=${encodeURIComponent(q)}`);
  target.innerHTML = models
    .slice(0, 60)
    .map(
      (model) => `
      <button class="suggestion" data-id="${model.id}">
        <strong>${escapeHtml(modelLabel(model))}</strong>
        <small>${escapeHtml(model.name)} · ${model.row_count} dòng</small>
      </button>`
    )
    .join("");
  target.querySelectorAll(".suggestion").forEach((button) => {
    const model = models.find((m) => String(m.id) === button.dataset.id);
    button.addEventListener("click", () => onPick(model));
  });
}

function pickModel(model) {
  state.selectedModel = model;
  $("selectedModel").textContent = modelLabel(model);
  $("selectedFile").textContent = model.name;
  $("modelSearch").value = "";
  $("modelResults").innerHTML = "";
}

function addCompareModel(model) {
  if (!state.compareModels.some((m) => m.id === model.id)) state.compareModels.push(model);
  $("compareModelResults").innerHTML = "";
  $("compareModelSearch").value = "";
  renderCompareChips();
}

function renderCompareChips() {
  $("compareSelected").innerHTML = state.compareModels
    .map((model) => `<span class="chip">${escapeHtml(modelLabel(model))} <button data-id="${model.id}" title="Remove">×</button></span>`)
    .join("");
  $("compareSelected").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.compareModels = state.compareModels.filter((m) => String(m.id) !== button.dataset.id);
      renderCompareChips();
    });
  });
}

function renderPartTree(row) {
  const level = Math.max(1, Math.min(Number(row.bom_level || 1), 3));
  const partNo = escapeHtml(row.part_no || "");
  return `<span class="part-code part-level-${level}" title="Lớp ${level}">${partNo}</span>`;
}

function renderTable(container, rows, terms = [], diffKeys = []) {
  if (!rows.length) {
    container.innerHTML = `<div class="summary">Không tìm thấy dòng phù hợp.</div>`;
    return;
  }
  container.innerHTML = `
    <table class="focused-table">
      <thead><tr>
        <th class="part-tree-col">料件編號</th>
        <th>品名</th>
        <th class="qty-col">用量</th>
        <th>規格</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr title="${escapeHtml(`${row.model} · ${row.file_name} · ${row.sheet} · row ${row.row_number}`)}">
              <td class="part-tree-col">${renderPartTree(row)}</td>
              <td class="${diffKeys.includes("name_cn") ? "diff" : ""}">${highlight(row.name_cn || "", terms)}</td>
              <td class="qty-col ${diffKeys.includes("quantity") ? "diff" : ""}">${highlight(row.quantity || "", terms)}</td>
              <td class="${diffKeys.includes("specification") ? "diff" : ""}">${highlight(row.specification || "", terms)}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function renderCompareTables(container, rows, terms = [], diffKeys = []) {
  if (!rows.length) {
    container.innerHTML = `<div class="summary">Không tìm thấy dòng phù hợp.</div>`;
    return;
  }
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const cards = state.compareModels.map((model, index) => {
    const modelRows = rows.filter((row) => row.file_id === model.id);
    const label = labels[index] || String(index + 1);
    return `
      <section class="compare-card">
        <div class="compare-card-head">
          <span class="compare-badge">${label}</span>
          <div>
            <strong>${escapeHtml(modelLabel(model))}</strong>
            <small>${escapeHtml(model.name)}</small>
          </div>
        </div>
        ${
          modelRows.length
            ? `<div class="table-shell inner-table">
                <table class="focused-table">
                  <thead><tr>
                    <th class="part-tree-col">料件編號</th>
                    <th>品名</th>
                    <th class="qty-col">用量</th>
                    <th>規格</th>
                  </tr></thead>
                  <tbody>
                    ${modelRows
                      .map(
                        (row) => `<tr title="${escapeHtml(`${row.model} · ${row.file_name} · ${row.sheet} · row ${row.row_number}`)}">
                          <td class="part-tree-col">${renderPartTree(row)}</td>
                          <td class="${diffKeys.includes("name_cn") ? "diff" : ""}">${highlight(row.name_cn || "", terms)}</td>
                          <td class="qty-col ${diffKeys.includes("quantity") ? "diff" : ""}">${highlight(row.quantity || "", terms)}</td>
                          <td class="${diffKeys.includes("specification") ? "diff" : ""}">${highlight(row.specification || "", terms)}</td>
                        </tr>`
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>`
            : `<div class="empty-compare">Không có dòng phù hợp.</div>`
        }
      </section>`;
  });
  container.innerHTML = `<div class="compare-results-grid">${cards.join("")}</div>`;
}

async function runSearch() {
  if (!state.selectedModel) {
    $("resultSummary").textContent = "Hãy chọn một BOM trước khi tìm linh kiện.";
    return;
  }
  const query = $("partSearch").value.trim();
  const data = await api("/api/search", {
    method: "POST",
    body: JSON.stringify({ model_id: state.selectedModel.id, query, limit: 500 }),
  });
  state.lastTerms = data.terms || [];
  $("termHint").textContent = data.terms?.length > 1 ? `Từ khóa liên quan: ${data.terms.join(", ")}` : "";
  $("resultSummary").textContent = `${data.results.length} dòng liên quan trong ${modelLabel(state.selectedModel)}`;
  renderTable($("results"), data.results, data.terms || []);
}

async function runCompare() {
  if (!state.compareModels.length) {
    $("compareSummary").textContent = "Hãy chọn ít nhất hai BOM để so sánh.";
    return;
  }
  const query = $("compareQuery").value.trim();
  const data = await api("/api/compare", {
    method: "POST",
    body: JSON.stringify({ model_ids: state.compareModels.map((m) => m.id), query, limit: 1000 }),
  });
  $("compareSummary").textContent = `${data.results.length} dòng, ${data.diff_keys.length} cột có khác biệt.`;
  renderCompareTables($("compareResults"), data.results, data.terms || [], data.diff_keys || []);
}

async function loadTerms() {
  state.terms = await api("/api/terminology");
  renderTerms();
}

function renderTerms() {
  const entries = Object.entries(state.terms).sort(([a], [b]) => a.localeCompare(b, "vi"));
  $("termsList").innerHTML = entries
    .map(
      ([vi, zh]) => `
      <div class="term-row">
        <strong>${escapeHtml(vi)}</strong>
        <code>${escapeHtml((zh || []).join(", "))}</code>
        <div class="term-row-actions">
          <button class="button secondary edit-term" data-term="${escapeHtml(vi)}">Edit</button>
          <button class="button secondary delete-term" data-term="${escapeHtml(vi)}">Delete</button>
        </div>
      </div>`
    )
    .join("");
  $("termsList").querySelectorAll(".edit-term").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.term;
      state.editingTerm = key;
      $("termVi").value = key;
      $("termZh").value = (state.terms[key] || []).join(", ");
      $("addTermBtn").textContent = "Cập nhật";
      $("cancelEditBtn").hidden = false;
      $("termVi").focus();
    });
  });
  $("termsList").querySelectorAll(".delete-term").forEach((button) => {
    button.addEventListener("click", () => {
      delete state.terms[button.dataset.term];
      if (state.editingTerm === button.dataset.term) cancelEditTerm();
      renderTerms();
    });
  });
}

async function saveTerms() {
  await api("/api/terminology", { method: "POST", body: JSON.stringify(state.terms) });
  await loadTerms();
}

function addTerm() {
  const vi = $("termVi").value.trim().toLowerCase();
  const zh = $("termZh").value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!vi || !zh.length) return;
  if (state.editingTerm && state.editingTerm !== vi) {
    delete state.terms[state.editingTerm];
  }
  state.terms[vi] = zh;
  cancelEditTerm();
  renderTerms();
}

function cancelEditTerm() {
  state.editingTerm = null;
  $("termVi").value = "";
  $("termZh").value = "";
  $("addTermBtn").textContent = "Thêm / Cập nhật";
  $("cancelEditBtn").hidden = true;
}

async function saveSettings() {
  await api("/api/settings", { method: "POST", body: JSON.stringify({ bom_folder: $("bomFolder").value.trim() }) });
  await api("/api/refresh", { method: "POST", body: "{}" });
  await loadStatus();
}

function bind() {
  document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  $("modelSearch").addEventListener(
    "input",
    debounce(() => searchModels($("modelSearch"), $("modelResults"), pickModel))
  );
  $("compareModelSearch").addEventListener(
    "input",
    debounce(() => searchModels($("compareModelSearch"), $("compareModelResults"), addCompareModel))
  );
  $("searchBtn").addEventListener("click", runSearch);
  $("partSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });
  $("compareBtn").addEventListener("click", runCompare);
  $("authLoginBtn").addEventListener("click", loginProtectedTabs);
  $("authCancelBtn").addEventListener("click", closeAuthModal);
  $("authPass").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loginProtectedTabs();
  });
  $("addTermBtn").addEventListener("click", addTerm);
  $("cancelEditBtn").addEventListener("click", cancelEditTerm);
  $("saveTermsBtn").addEventListener("click", saveTerms);
  $("saveSettingsBtn").addEventListener("click", saveSettings);
  $("refreshBtn").addEventListener("click", async () => {
    await api("/api/refresh", { method: "POST", body: "{}" });
    await loadStatus();
  });
  $("reindexBtn").addEventListener("click", async () => {
    await api("/api/reindex", { method: "POST", body: "{}" });
    await loadStatus();
  });
}

async function boot() {
  bind();
  await Promise.all([loadSettings(), loadTerms(), loadStatus()]);
  setInterval(loadStatus, 1500);
}

boot().catch((error) => {
  $("statusText").textContent = error.message;
});
