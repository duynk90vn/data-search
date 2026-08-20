const state = {
  files: [],
  rows: [],
  terms: {},
  selectedModel: null,
  compareModels: [],
  authenticated: sessionStorage.getItem("online-bom-auth") === "true",
  pendingTab: null,
};

const ADMIN_USER = "duynk90";
const ADMIN_PASSWORD_HASH = "7e77334c65db47e4bacd8e2f6b3c0051c3963ed8b0bbf9982e310cb32baf2d32";
const HIDDEN_MODEL_NAMES = new Set(["tonghopbom", "tonghopbomcapnhat"]);
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s\-_./\\()（）[\]{}]+/g, "");
}

function normalizedWords(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isHiddenModel(file) {
  return HIDDEN_MODEL_NAMES.has(normalizeText(file.model));
}

function customerModel(file) {
  const match = String(file.name || "").match(/\(([^()]+)\)(?:\.[^.]+)?$/);
  return match ? match[1].trim() : "";
}

function modelFromBomName(file) {
  const base = String(file.name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/\([^()]+\)$/, "")
    .trim();
  const withoutCategory = base.replace(/^[\u4e00-\u9fff]+[-_ ]*/, "").trim();
  return withoutCategory || file.model;
}

function modelLabel(file) {
  const customer = customerModel(file);
  if (!customer) return file.model;
  const model = normalizeText(customer) === normalizeText(file.model) ? modelFromBomName(file) : file.model;
  return `${model}(${customer})`;
}

function visibleFiles() {
  return state.files.filter((file) => !isHiddenModel(file));
}

function phraseContains(container, phrase) {
  const hay = normalizedWords(container);
  const needle = normalizedWords(phrase);
  if (!needle.length || needle.length === 1) return false;
  for (let i = 0; i <= hay.length - needle.length; i += 1) {
    if (needle.every((word, index) => hay[i + index] === word)) return true;
  }
  return false;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function expandTerms(query) {
  const q = normalizeText(query);
  const terms = [query];
  for (const [vi, zh] of Object.entries(state.terms)) {
    if (normalizeText(vi) === q) terms.push(vi, ...zh);
  }
  if (terms.length > 1) return unique(terms);
  for (const [vi, zh] of Object.entries(state.terms)) {
    if (phraseContains(vi, query)) terms.push(vi, ...zh);
    if (zh.some((term) => query && term.includes(query))) terms.push(vi, ...zh);
  }
  return unique(terms);
}

function scoreRow(row, query, terms) {
  const text = row.name_cn || "";
  const norm = normalizeText(text);
  const q = normalizeText(query);
  if (query && text.includes(query)) return 100;
  if (q && norm.includes(q)) return 92;
  for (const term of terms) {
    if (term && text.includes(term)) return 88;
    const nt = normalizeText(term);
    if (nt && norm.includes(nt)) return 84;
  }
  return 0;
}

function parseQty(value) {
  const match = String(value || "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function formatQty(value) {
  if (value === null || Number.isNaN(value)) return "";
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function mergeUnique(existing, next) {
  const parts = String(existing || "").split("\n").filter(Boolean);
  if (next && !parts.includes(next)) parts.push(next);
  return parts.join("\n");
}

function aggregate(rows) {
  const grouped = new Map();
  rows.forEach((row, index) => {
    const key = row.part_no ? `${row.file_id}|${row.part_no}` : `${row.file_id}|row-${index}`;
    const qty = parseQty(row.quantity);
    if (!grouped.has(key)) {
      grouped.set(key, { ...row, _qty: qty, _score: row.score });
      return;
    }
    const current = grouped.get(key);
    if (qty !== null) current._qty = (current._qty || 0) + qty;
    current.score = Math.max(current.score || 0, row.score || 0);
    current.name_cn = mergeUnique(current.name_cn, row.name_cn);
    current.specification = mergeUnique(current.specification, row.specification);
  });
  return [...grouped.values()].map((row) => {
    if (row._qty !== null) row.quantity = formatQty(row._qty);
    delete row._qty;
    delete row._score;
    return row;
  });
}

function searchModels(query, limit = 20) {
  const q = normalizeText(query);
  if (!q) return [];
  return state.files
    .filter((file) => !isHiddenModel(file))
    .map((file) => {
      const hay = normalizeText(`${file.model} ${file.name}`);
      const score = hay.includes(q) ? 100 : 0;
      return { ...file, score };
    })
    .filter((file) => file.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function searchRows(modelIds, query, limit = 500) {
  const terms = expandTerms(query);
  const idSet = new Set(modelIds);
  const rows = state.rows
    .filter((row) => idSet.has(row.file_id))
    .map((row) => ({ ...row, score: scoreRow(row, query, terms) }))
    .filter((row) => row.score >= 42 || !query)
    .sort((a, b) => b.score - a.score || a.file_name.localeCompare(b.file_name) || a.row_number - b.row_number);
  return { terms, rows: aggregate(rows).slice(0, limit) };
}

function highlight(value, terms) {
  let html = escapeHtml(value);
  unique(terms)
    .sort((a, b) => b.length - a.length)
    .forEach((term) => {
      const safe = escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(new RegExp(safe, "gi"), (match) => `<span class="match">${match}</span>`);
    });
  return html;
}

function renderTable(container, rows, terms) {
  if (!rows.length) {
    container.innerHTML = `<div class="card">Không tìm thấy dòng phù hợp.</div>`;
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr>
        <th class="part-col">料件編號</th>
        <th>品名</th>
        <th class="qty-col">用量</th>
        <th>規格</th>
      </tr></thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
              <td class="part-col">${escapeHtml(row.part_no)}</td>
              <td>${highlight(row.name_cn, terms)}</td>
              <td class="qty-col">${escapeHtml(row.quantity)}</td>
              <td>${highlight(row.specification, terms)}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function renderModelChips(input, target, onPick) {
  const models = searchModels(input.value);
  target.innerHTML = models.map((m) => `<button class="chip" data-id="${m.id}">${escapeHtml(modelLabel(m))}</button>`).join("");
  target.querySelectorAll(".chip").forEach((button) => {
    button.addEventListener("click", () => onPick(models.find((m) => String(m.id) === button.dataset.id)));
  });
}

function pickModel(model) {
  state.selectedModel = model;
  $("selectedModel").textContent = `${modelLabel(model)} - ${model.name}`;
  $("modelInput").value = "";
  $("modelSuggestions").innerHTML = "";
}

function runSearch() {
  if (!state.selectedModel) {
    $("resultCount").textContent = "Chưa chọn BOM";
    return;
  }
  const query = $("partInput").value.trim();
  const result = searchRows([state.selectedModel.id], query);
  $("termHint").textContent = result.terms.length > 1 ? `Từ khóa liên quan: ${result.terms.join(", ")}` : "";
  $("resultCount").textContent = `${result.rows.length}`;
  renderTable($("results"), result.rows, result.terms);
}

function renderCompareSelected() {
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  $("compareSelected").innerHTML =
    state.compareModels
      .map(
        (model, index) =>
          `<span class="selected-pill"><b>${labels[index]}</b>${escapeHtml(modelLabel(model))}<button data-id="${model.id}">×</button></span>`
      )
      .join("") || "Chưa chọn BOM";
  $("compareSelected").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.compareModels = state.compareModels.filter((model) => String(model.id) !== button.dataset.id);
      renderCompareSelected();
    });
  });
}

function addCompareModel(model) {
  if (!state.compareModels.some((item) => item.id === model.id)) state.compareModels.push(model);
  $("compareModelInput").value = "";
  $("compareSuggestions").innerHTML = "";
  renderCompareSelected();
}

function runCompare() {
  if (!state.compareModels.length) {
    $("compareCount").textContent = "Hãy chọn ít nhất 2 BOM để so sánh.";
    return;
  }
  const query = $("comparePartInput").value.trim();
  const result = searchRows(
    state.compareModels.map((model) => model.id),
    query,
    1000
  );
  $("compareCount").textContent = `${result.rows.length} dòng`;
  const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  $("compareResults").innerHTML = `<div class="compare-grid">${state.compareModels
    .map((model, index) => {
      const rows = result.rows.filter((row) => row.file_id === model.id);
      return `<section class="compare-card">
        <div class="compare-head"><span class="badge">${labels[index]}</span><span>${escapeHtml(modelLabel(model))}</span></div>
        <div class="table-wrap" id="compareTable${index}"></div>
      </section>`;
    })
    .join("")}</div>`;
  state.compareModels.forEach((model, index) => {
    renderTable($(`compareTable${index}`), result.rows.filter((row) => row.file_id === model.id), result.terms);
  });
}

function switchTab(tab) {
  if (["terms", "data", "settings"].includes(tab) && !state.authenticated) {
    state.pendingTab = tab;
    $("loginModal").hidden = false;
    $("loginPass").value = "";
    $("loginPass").focus();
    return;
  }
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === tab));
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function login(event) {
  event.preventDefault();
  const ok = $("loginUser").value.trim() === ADMIN_USER && (await sha256($("loginPass").value)) === ADMIN_PASSWORD_HASH;
  if (!ok) {
    $("loginError").textContent = "Tài khoản hoặc mật khẩu chưa đúng.";
    return;
  }
  state.authenticated = true;
  sessionStorage.setItem("online-bom-auth", "true");
  $("loginModal").hidden = true;
  switchTab(state.pendingTab || "terms");
}

function renderTerms() {
  $("termsList").innerHTML = Object.entries(state.terms)
    .sort(([a], [b]) => a.localeCompare(b, "vi"))
    .map(([vi, zh]) => `<div class="term-row"><strong>${escapeHtml(vi)}</strong><span>${escapeHtml(zh.join(", "))}</span></div>`)
    .join("");
}

function bind() {
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $("modelInput").addEventListener("input", () => renderModelChips($("modelInput"), $("modelSuggestions"), pickModel));
  $("compareModelInput").addEventListener("input", () => renderModelChips($("compareModelInput"), $("compareSuggestions"), addCompareModel));
  $("clearModel").addEventListener("click", () => {
    $("modelInput").value = "";
    $("modelSuggestions").innerHTML = "";
  });
  $("searchBtn").addEventListener("click", runSearch);
  $("partInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") runSearch();
  });
  $("compareBtn").addEventListener("click", runCompare);
  $("loginForm").addEventListener("submit", login);
  $("loginCancel").addEventListener("click", () => {
    $("loginModal").hidden = true;
  });
}

async function boot() {
  bind();
  const response = await fetch("public-data/bom-data.json");
  const data = await response.json();
  state.files = data.files;
  state.rows = data.rows;
  state.terms = data.terminology;
  $("modelCount").textContent = visibleFiles().length;
  $("dataModels").textContent = visibleFiles().length;
  $("dataRows").textContent = state.rows.length;
  $("dataTerms").textContent = Object.keys(state.terms).length;
  renderTerms();
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="page"><div class="card">Không tải được dữ liệu: ${escapeHtml(error.message)}</div></main>`;
});
