// ---------- State ----------
let allCards = [];
let activeAges = new Set();
let activeUnits = new Set();
let searchTerm = "";

let adminPassword = sessionStorage.getItem("akram_admin_pw") || null;
let adminRoster = null; // decrypted full roster, cached in memory once unlocked
const parentIcCache = new Map(); // cardId -> ic digits, remembered for this tab session

// selections persist in this browser: { cardId: "selected" | "reserved" }
let selections = loadSelections();

const AGE_GROUPS = ["13Y", "14Y", "15Y", "16Y", "17Y"];
const UNITS = ["Forwards", "Backlines", "Scrum-half"];
const FORM_LABELS = ["1", "2", "3", "4", "5"];

// ---------- Selection persistence ----------
function loadSelections() {
  try {
    return JSON.parse(localStorage.getItem("akram_selections") || "{}");
  } catch (e) {
    return {};
  }
}
function saveSelections() {
  localStorage.setItem("akram_selections", JSON.stringify(selections));
}
function cycleSelection(id) {
  const cur = selections[id];
  if (!cur) selections[id] = "selected";
  else if (cur === "selected") selections[id] = "reserved";
  else delete selections[id];
  saveSelections();
  render();
}
function extractForm(tingkatan) {
  const m = (tingkatan || "").match(/TINGKATAN\s*(\d+)/i);
  return m ? m[1] : null;
}
function classLabel(card) {
  const form = extractForm(card.tingkatan);
  if (form && card.kelas) return `${form} ${card.kelas}`;
  return card.kelas || (form ? `Form ${form}` : "—");
}

// ---------- Crypto helpers (must match build.py exactly) ----------
function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function deriveKey(secret, saltB64, iterations) {
  const enc = new TextEncoder();
  const salt = b64ToBytes(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
}

async function decryptPayload(payload, secret) {
  const key = await deriveKey(secret, payload.salt, payload.iterations);
  const iv = b64ToBytes(payload.iv);
  const ciphertext = b64ToBytes(payload.ciphertext);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function digitsOnly(s) {
  return (s || "").replace(/\D/g, "");
}

// ---------- Data load ----------
async function loadCards() {
  const res = await fetch("data/cards.json");
  allCards = await res.json();
  renderFilters();
  render();
}

// ---------- Filters & rendering ----------
function renderFilters() {
  const ageBox = document.getElementById("ageFilters");
  ageBox.innerHTML = "";
  AGE_GROUPS.forEach(age => {
    const btn = document.createElement("button");
    btn.className = "pill";
    btn.textContent = age;
    btn.onclick = () => {
      activeAges.has(age) ? activeAges.delete(age) : activeAges.add(age);
      render();
    };
    ageBox.appendChild(btn);
  });

  const unitBox = document.getElementById("unitFilters");
  unitBox.innerHTML = "";
  UNITS.forEach(unit => {
    const btn = document.createElement("button");
    btn.className = "pill";
    btn.textContent = unit;
    btn.onclick = () => {
      activeUnits.has(unit) ? activeUnits.delete(unit) : activeUnits.add(unit);
      render();
    };
    unitBox.appendChild(btn);
  });
}

function matchesFilters(card) {
  if (activeAges.size && !activeAges.has(card.ageGroup)) return false;
  if (activeUnits.size && !activeUnits.has(card.unit)) return false;
  if (searchTerm) {
    const hay = `${card.name} ${card.nickname || ""}`.toLowerCase();
    if (!hay.includes(searchTerm.toLowerCase())) return false;
  }
  return true;
}

function render() {
  // pill active states
  document.querySelectorAll("#ageFilters .pill").forEach(b => {
    b.classList.toggle("active", activeAges.has(b.textContent));
  });
  document.querySelectorAll("#unitFilters .pill").forEach(b => {
    b.classList.toggle("active", activeUnits.has(b.textContent));
  });

  const filtered = allCards.filter(matchesFilters);
  const grid = document.getElementById("cardGrid");
  const empty = document.getElementById("emptyState");
  const status = document.getElementById("statusRow");

  status.textContent = `${filtered.length} of ${allCards.length} players`;

  grid.innerHTML = "";
  empty.classList.toggle("hidden", filtered.length > 0);

  filtered.forEach(card => {
    const state = selections[card.id]; // "selected" | "reserved" | undefined
    const el = document.createElement("div");
    el.className = "card" + (state ? ` ${state}` : "");
    el.innerHTML = `
      <span class="state-badge">${state === "selected" ? "Selected" : state === "reserved" ? "Reserved" : ""}</span>
      <button class="plus" data-id="${card.id}">+</button>
      <img class="photo" src="${card.photo}" alt="" onerror="this.style.background='#f3d9d4'; this.src='';">
      <p class="nickname">${card.nickname || card.name}</p>
      <p class="fullname">${card.name}</p>
      <p class="meta">${card.unit || card.position || "—"}<span class="dot">•</span>${card.ageGroup || card.tingkatan || ""}</p>
    `;
    el.querySelector(".plus").onclick = (e) => { e.stopPropagation(); openModal(card); };
    el.onclick = () => cycleSelection(card.id);
    grid.appendChild(el);
  });

  updateBottomBar(filtered);
}

function updateBottomBar(filtered) {
  const filteredDecided = filtered.filter(c => selections[c.id]).length;
  const avail = filtered.length - filteredDecided;
  const totalSel = Object.values(selections).filter(s => s === "selected").length;
  const totalRes = Object.values(selections).filter(s => s === "reserved").length;

  document.getElementById("statAvail").textContent = avail;
  document.getElementById("statSel").textContent = totalSel;
  document.getElementById("statRes").textContent = totalRes;
}

document.getElementById("searchInput").addEventListener("input", e => {
  searchTerm = e.target.value;
  render();
});
document.getElementById("resetBtn").addEventListener("click", () => {
  activeAges.clear();
  activeUnits.clear();
  searchTerm = "";
  document.getElementById("searchInput").value = "";
  render();
});

// ---------- Modal ----------
const overlay = document.getElementById("overlay");
const modalBody = document.getElementById("modalBody");
document.getElementById("closeModal").onclick = () => overlay.classList.add("hidden");
overlay.addEventListener("click", e => { if (e.target === overlay) overlay.classList.add("hidden"); });

function openModal(card) {
  overlay.classList.remove("hidden");
  renderAuthGate(card);
}

function renderAuthGate(card, errorMsg) {
  modalBody.innerHTML = `
    <h2>${card.nickname || card.name}</h2>
    <p class="sub">${card.name}</p>
    <div class="tabs">
      <button id="tabAdmin" class="active">Coach / Admin</button>
      <button id="tabParent">Parent</button>
    </div>
    <div id="authArea"></div>
  `;
  document.getElementById("tabAdmin").onclick = () => { setTab("admin"); };
  document.getElementById("tabParent").onclick = () => { setTab("parent"); };

  let mode = "admin";
  function setTab(m) {
    mode = m;
    document.getElementById("tabAdmin").classList.toggle("active", m === "admin");
    document.getElementById("tabParent").classList.toggle("active", m === "parent");
    renderAuthForm();
  }

  function renderAuthForm(err) {
    const area = document.getElementById("authArea");
    if (mode === "admin") {
      area.innerHTML = `
        <div class="auth-panel">
          ${err ? `<div class="error-msg">${err}</div>` : ""}
          <label for="pwInput">Admin password</label>
          <input type="password" id="pwInput" placeholder="Enter password">
          <div class="checkbox-row">
            <input type="checkbox" id="rememberPw" ${adminPassword ? "checked" : ""}>
            <label for="rememberPw" style="margin:0">Remember for this browser session</label>
          </div>
          <button class="submit" id="submitAdmin">Unlock full profile</button>
        </div>
      `;
      document.getElementById("submitAdmin").onclick = () => tryAdmin(card);
      document.getElementById("pwInput").addEventListener("keydown", e => { if (e.key === "Enter") tryAdmin(card); });
      if (adminPassword) document.getElementById("pwInput").value = adminPassword;
    } else {
      area.innerHTML = `
        <div class="auth-panel">
          ${err ? `<div class="error-msg">${err}</div>` : ""}
          <label for="icInput">Your child's IC number</label>
          <input type="text" id="icInput" placeholder="e.g. 130103040431" inputmode="numeric">
          <button class="submit" id="submitParent">View my child's profile</button>
        </div>
      `;
      document.getElementById("submitParent").onclick = () => tryParent(card);
      document.getElementById("icInput").addEventListener("keydown", e => { if (e.key === "Enter") tryParent(card); });
    }
  }
  renderAuthForm();
}

async function tryAdmin(card) {
  const pw = document.getElementById("pwInput").value;
  const remember = document.getElementById("rememberPw").checked;
  try {
    if (!adminRoster || pw !== adminPassword) {
      const res = await fetch("data/admin.enc.json");
      const payload = await res.json();
      const decrypted = await decryptPayload(payload, pw);
      adminRoster = decrypted.players;
      adminPassword = pw;
      if (remember) sessionStorage.setItem("akram_admin_pw", pw);
    }
    const profile = adminRoster.find(p => p.id === card.id);
    if (!profile) throw new Error("not found");
    renderProfile(profile, "Admin view");
  } catch (e) {
    adminRoster = null;
    renderAuthGate(card, "Incorrect password, or no data found.");
  }
}

async function tryParent(card) {
  const icRaw = document.getElementById("icInput").value;
  const ic = digitsOnly(icRaw);
  if (ic.length !== 12) {
    renderAuthGate(card, "Please enter a valid 12-digit IC number.");
    return;
  }
  try {
    const hash = await sha256Hex(ic);
    const res = await fetch(`data/players/${hash}.json`);
    if (!res.ok) throw new Error("not found");
    const payload = await res.json();
    const profile = await decryptPayload(payload, ic);
    if (profile.id !== card.id) {
      renderAuthGate(card, "That IC number doesn't match this player's record.");
      return;
    }
    parentIcCache.set(card.id, ic);
    renderProfile(profile, "Parent view");
  } catch (e) {
    renderAuthGate(card, "That IC number doesn't match any player record.");
  }
}

function row(label, value) {
  const v = (value === null || value === undefined || value === "") ? null : value;
  return `<div class="row"><span class="k">${label}</span><span class="v ${v ? "" : "empty"}">${v || "Not provided"}</span></div>`;
}

// ---------- Phone actions (call / WhatsApp / copy) ----------
function normalizePhoneDigits(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  const digits = cleaned.replace(/^\+/, "");
  if (!digits) return null;
  if (digits.startsWith("60")) return digits;
  if (digits.startsWith("0")) return "60" + digits.slice(1); // Malaysian local -> international
  return digits;
}

const ICON_CALL = `<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 3.5c0-.6.5-1 1-1h2.2c.5 0 .9.3 1 .8l.7 2.8c.1.4 0 .8-.3 1.1L7.3 8.4c1 2.1 2.7 3.8 4.8 4.8l1.2-1.3c.3-.3.7-.4 1.1-.3l2.8.7c.5.1.8.5.8 1v2.2c0 .6-.4 1-1 1C9.9 16.5 3.5 10.1 3.5 4.5c0-.5.5-1 .5-1z"/></svg>`;
const ICON_WHATSAPP = `<svg viewBox="0 0 20 20" width="15" height="15" fill="currentColor"><path d="M10 3a7 7 0 0 0-6 10.6L3 17l3.5-1a7 7 0 1 0 3.5-13zm0 1.6a5.4 5.4 0 0 1 4.6 8.2l-.2.4.6 2.2-2.3-.6-.4.2a5.4 5.4 0 1 1-2.3-10.4z"/><path d="M7.7 6.9c.2-.4.4-.4.6-.4h.4c.1 0 .3 0 .5.4l.6 1.4c.1.2 0 .4-.1.5l-.4.4c-.1.2-.1.3 0 .5.3.6 1.1 1.4 1.7 1.7.2.1.3.1.5 0l.4-.4c.1-.1.3-.2.5-.1l1.4.6c.3.2.4.3.4.5v.4c0 .2-.2.5-.4.6-.5.4-1.1.5-1.7.3-1.6-.4-3.5-2.3-3.9-3.9-.2-.6-.1-1.2.3-1.7z"/></svg>`;
const ICON_COPY = `<svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M4 12.5V5.5A1.5 1.5 0 0 1 5.5 4h7"/></svg>`;

function phoneField(label, rawValue) {
  if (!rawValue || !String(rawValue).trim()) {
    return `<div class="row"><span class="k">${label}</span><span class="v empty">Not provided</span></div>`;
  }
  const parts = String(rawValue).split(/[,/]/).map(s => s.trim()).filter(Boolean);
  const validParts = parts.filter(p => normalizePhoneDigits(p));
  if (!validParts.length) {
    return `<div class="row"><span class="k">${label}</span><span class="v empty">Not provided</span></div>`;
  }
  return validParts.map((part, i) => {
    const digits = normalizePhoneDigits(part);
    const labelText = validParts.length > 1 ? `${label} ${i + 1}` : label;
    return `
      <div class="row phone-row">
        <span class="k">${labelText}</span>
        <span class="v phone-actions">
          <span class="phone-number" data-copy="${part}" title="Click to copy">${part}</span>
          <a class="icon-btn call-btn" href="tel:+${digits}" title="Call">${ICON_CALL}</a>
          <a class="icon-btn wa-btn" href="https://wa.me/${digits}" target="_blank" rel="noopener" title="WhatsApp">${ICON_WHATSAPP}</a>
          <button type="button" class="icon-btn copy-btn" data-copy="${part}" title="Copy number">${ICON_COPY}</button>
        </span>
      </div>
    `;
  }).join("");
}

function renderProfile(p, viewLabel) {
  modalBody.innerHTML = `
    <h2>${p.nickname || p.name}</h2>
    <p class="sub">${p.name} &middot; ${viewLabel}</p>
    <div class="profile">
      <div class="section-title">Player</div>
      ${row("IC number", p.icNumber)}
      ${row("Date of birth", p.dateOfBirth)}
      ${row("Tingkatan", p.tingkatan)}
      ${row("Kelas", p.kelas)}
      ${row("Unit", p.unit)}
      ${row("Position", p.position)}
      ${row("Secondary position", p.secondaryPosition)}
      ${phoneField("Phone", p.phoneNumber)}
      ${row("Address", p.address)}

      <div class="section-title">Physical</div>
      ${row("Height (cm)", p.heightCm)}
      ${row("Weight (kg)", p.weightKg)}
      ${row("Blood group", p.bloodGroup)}

      <div class="section-title">Medical</div>
      ${row("Allergies", p.allergies)}
      ${row("Medical history", p.medicalHistory)}
      ${row("Medical history detail", p.medicalHistoryDetail)}
      ${row("Current medication", p.currentMedication)}
      ${row("Medication detail", p.currentMedicationDetail)}

      <div class="section-title">Guardian 1</div>
      ${row("Name", p.guardian1Name)}
      ${row("IC number", p.guardian1Ic)}
      ${phoneField("Phone", p.guardian1Phone)}
      ${row("Work", p.guardian1Work)}

      <div class="section-title">Guardian 2</div>
      ${row("Name", p.guardian2Name)}
      ${row("IC number", p.guardian2Ic)}
      ${phoneField("Phone", p.guardian2Phone)}
      ${row("Work", p.guardian2Work)}

      <div class="section-title">Other emergency contacts</div>
      ${row("Details", p.otherEmergencyContacts)}
    </div>
  `;
  modalBody.querySelectorAll(".phone-number[data-copy], .copy-btn[data-copy]").forEach(el => {
    el.onclick = (e) => { e.preventDefault(); copyToClipboard(el.dataset.copy); };
  });
}

// ---------- View switching (Selection <-> Summary) ----------
document.getElementById("viewSummaryBtn").onclick = () => {
  document.getElementById("selectionView").classList.add("hidden");
  document.getElementById("summaryView").classList.remove("hidden");
  renderSummary();
};
document.getElementById("backToSelection").onclick = () => {
  document.getElementById("summaryView").classList.add("hidden");
  document.getElementById("selectionView").classList.remove("hidden");
};
document.getElementById("resetAllBtn").onclick = () => {
  if (!confirm("Reset all selections and reserves? This can't be undone.")) return;
  selections = {};
  saveSelections();
  render();
  renderSummary();
};

function getCardsByState(state) {
  return allCards.filter(c => selections[c.id] === state);
}

// ---------- Summary screen ----------
function renderSummary() {
  const selectedCards = getCardsByState("selected");
  const reservedCards = getCardsByState("reserved");

  document.getElementById("teamCountLabel").textContent = selectedCards.length;
  document.getElementById("finalCountBadge").textContent = selectedCards.length;
  document.getElementById("reservedCountBadge").textContent = reservedCards.length;

  // Unit breakdown — public data only, no password needed
  const unitCounts = {};
  UNITS.forEach(u => unitCounts[u] = 0);
  selectedCards.forEach(c => { if (c.unit && unitCounts.hasOwnProperty(c.unit)) unitCounts[c.unit]++; });
  renderBarChart("unitChart", UNITS.map(u => [u, unitCounts[u]]));

  // Form breakdown — public data only
  const formCounts = {};
  FORM_LABELS.forEach(f => formCounts[f] = 0);
  selectedCards.forEach(c => {
    const f = extractForm(c.tingkatan);
    if (f && formCounts.hasOwnProperty(f)) formCounts[f]++;
  });
  renderBarChart("formChart", FORM_LABELS.map(f => [`Form ${f}`, formCounts[f]]));

  // Final + reserved lists need IC numbers -> gated behind admin password
  renderGatedLists(selectedCards, reservedCards);
}

function renderBarChart(containerId, entries) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const el = document.getElementById(containerId);
  el.innerHTML = entries.map(([label, n]) => `
    <div class="bar-row">
      <span class="bar-label">${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${(n / max) * 100}%"></div></div>
      <span class="bar-count">${n}</span>
    </div>
  `).join("");
}

async function renderGatedLists(selectedCards, reservedCards) {
  const gate = document.getElementById("finalListAuthGate");

  if (adminRoster) { // already unlocked earlier this session
    gate.innerHTML = "";
    fillLists(selectedCards, reservedCards);
    return;
  }
  if (adminPassword) { // try a remembered password silently
    try {
      await unlockAdminWith(adminPassword);
      gate.innerHTML = "";
      fillLists(selectedCards, reservedCards);
      return;
    } catch (e) {
      adminPassword = null;
      sessionStorage.removeItem("akram_admin_pw");
    }
  }
  renderSummaryAuthGate(selectedCards, reservedCards);
}

function renderSummaryAuthGate(selectedCards, reservedCards, err) {
  const gate = document.getElementById("finalListAuthGate");
  document.getElementById("finalListTable").classList.add("hidden");
  document.getElementById("reservedListTable").classList.add("hidden");
  gate.innerHTML = `
    <div class="auth-panel">
      ${err ? `<div class="error-msg">${err}</div>` : ""}
      <label for="summaryPwInput">Admin password (needed to show IC numbers)</label>
      <input type="password" id="summaryPwInput" placeholder="Enter password">
      <button class="submit" id="summaryPwSubmit">Unlock list</button>
    </div>
  `;
  const go = async () => {
    const pw = document.getElementById("summaryPwInput").value;
    try {
      await unlockAdminWith(pw);
      gate.innerHTML = "";
      fillLists(selectedCards, reservedCards);
    } catch (e) {
      renderSummaryAuthGate(selectedCards, reservedCards, "Incorrect password.");
    }
  };
  document.getElementById("summaryPwSubmit").onclick = go;
  document.getElementById("summaryPwInput").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
}

async function unlockAdminWith(password) {
  const res = await fetch("data/admin.enc.json");
  const payload = await res.json();
  const decrypted = await decryptPayload(payload, password);
  adminRoster = decrypted.players;
  adminPassword = password;
}

function fillLists(selectedCards, reservedCards) {
  fillTable("finalListTable", "finalListBody", selectedCards, "No players selected yet.");
  fillTable("reservedListTable", "reservedListBody", reservedCards, "No players reserved.");
}

function fillTable(tableId, bodyId, cards, emptyMsg) {
  const table = document.getElementById(tableId);
  const body = document.getElementById(bodyId);
  const wrap = table.parentElement;
  const existingMsg = wrap.querySelector(".table-empty-msg");
  if (existingMsg) existingMsg.remove();

  if (!cards.length) {
    table.classList.add("hidden");
    body.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "table-empty-msg";
    msg.textContent = emptyMsg;
    wrap.appendChild(msg);
    return;
  }

  table.classList.remove("hidden");
  body.innerHTML = cards.map(card => {
    const profile = adminRoster.find(p => p.id === card.id);
    const ic = profile ? profile.icNumber : "—";
    return `
      <tr>
        <td class="copy-cell" data-copy="${card.name}">${card.name}</td>
        <td class="copy-cell ic-cell" data-copy="${ic}">${ic}</td>
        <td>${classLabel(card)}</td>
      </tr>
    `;
  }).join("");
  body.querySelectorAll(".copy-cell").forEach(td => {
    td.onclick = () => copyToClipboard(td.dataset.copy);
  });
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => showToast(`Copied ${text}`));
}

let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 1500);
}

// ---------- Document generation (PDF via browser print) ----------
// No external PDF library is used — the printable content is built as a
// hidden DOM node, then window.print() is triggered. The person picks
// "Save as PDF" as the destination in their browser's print dialog. This
// keeps the site dependency-free and works identically on GitHub Pages.

function formatDatePart(dstr) {
  if (!dstr) return "";
  const [y, m, d] = dstr.split("-").map(Number);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${d} ${months[m - 1]} ${y}`;
}
function formatDateRange(start, end) {
  if (!start && !end) return "";
  if (start && end && start !== end) return `${formatDatePart(start)} – ${formatDatePart(end)}`;
  return formatDatePart(start || end);
}

// Sort with the highest Form number first (e.g. "5 XXXX" above "1 XXXX"),
// then alphabetically by class, then by name within the same class.
function sortForSummaryPrint(cards) {
  return [...cards].sort((a, b) => {
    const fa = parseInt(extractForm(a.tingkatan) || "0", 10);
    const fb = parseInt(extractForm(b.tingkatan) || "0", 10);
    if (fb !== fa) return fb - fa;
    const ka = (a.kelas || "").localeCompare(b.kelas || "");
    if (ka !== 0) return ka;
    return (a.name || "").localeCompare(b.name || "");
  });
}

function buildPrintRows(sortedCards) {
  return sortedCards.map((card, idx) => {
    const cls = classLabel(card);
    return `<tr><td>${idx + 1}</td><td>${card.name}</td><td>${cls}</td></tr>`;
  }).join("");
}

function generateSummaryPagePDF() {
  const selectedCards = getCardsByState("selected");
  if (!selectedCards.length) {
    alert("No players are selected yet — pick your squad on the selection screen first.");
    return;
  }
  const sorted = sortForSummaryPrint(selectedCards);
  const tournamentName = document.getElementById("tournamentNameInput").value.trim();
  const startDate = document.getElementById("tournamentStartDate").value;
  const endDate = document.getElementById("tournamentEndDate").value;
  const venue = document.getElementById("venueInput").value.trim();
  const dateStr = formatDateRange(startDate, endDate);
  const generatedOn = formatDatePart(new Date().toISOString().slice(0, 10));

  const html = `
    <div class="print-header">
      <p class="print-eyebrow">🏉 Akademi Ragbi Melaka</p>
      <h1>${tournamentName || "Tournament Summary"}</h1>
      <table class="print-meta">
        ${dateStr ? `<tr><td>Date</td><td>${dateStr}</td></tr>` : ""}
        ${venue ? `<tr><td>Venue</td><td>${venue}</td></tr>` : ""}
        <tr><td>Total Players</td><td>${sorted.length}</td></tr>
      </table>
    </div>
    <table class="print-table">
      <thead><tr><th>#</th><th>Name</th><th>Class</th></tr></thead>
      <tbody>${buildPrintRows(sorted)}</tbody>
    </table>
    <p class="print-footer">Generated ${generatedOn}</p>
  `;

  const existing = document.getElementById("printArea");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "printArea";
  div.className = "print-only";
  div.innerHTML = html;
  document.body.appendChild(div);
  window.print();
}

window.addEventListener("afterprint", () => {
  const el = document.getElementById("printArea");
  if (el) el.remove();
});

document.getElementById("genSummaryBtn").onclick = generateSummaryPagePDF;

// ---------- Document 2: Kebenaran Ibu Bapa (parental/warden consent) ----------
// Same print-to-PDF mechanism as Document 1 — one HTML block per student,
// each forced onto its own printed page via CSS page-break rules.

const WARDEN_INFO = {
  name: "KHAIRUL ADHAM BIN ARIPEN",
  address: "ASRAMA SMK TELOK MAS, SMK TELOK MAS, 75460, TELOK MAS, MELAKA",
  phone: "+60 10-420 8965",
};
// Edit these two constants if the school's details or the accompanying
// teacher change — they're used on every consent letter.
const SCHOOL_NAME_LINES = ["SEKOLAH MENENGAH KEBANGSAAN TELOK MAS,", "TELOK MAS, 75460 MELAKA."];
const SCHOOL_CONTACT_LINE = "Tel: 06-2615292  Faks: 0626194122  Email: mea-2098@yahoo.com";
const TEACHER_IN_CHARGE = "HASMOL WATAN BIN SHAMSOL BAHRIN";

let consentContact = loadConsentContact();
function loadConsentContact() {
  try { return JSON.parse(localStorage.getItem("akram_consent_contact") || "{}"); }
  catch (e) { return {}; }
}
function saveConsentContact() {
  localStorage.setItem("akram_consent_contact", JSON.stringify(consentContact));
}

// Generic admin-password gate, reusable for any document that needs
// guardian details decrypted first.
function openAdminGateFor(onSuccess) {
  overlay.classList.remove("hidden");
  const render = (err) => {
    modalBody.innerHTML = `
      <h2>Admin unlock needed</h2>
      <p class="sub">This document needs guardian details from the encrypted roster.</p>
      <div class="auth-panel">
        ${err ? `<div class="error-msg">${err}</div>` : ""}
        <label for="gatePwInput">Admin password</label>
        <input type="password" id="gatePwInput" placeholder="Enter password">
        <button class="submit" id="gatePwSubmit">Unlock</button>
      </div>
    `;
    document.getElementById("gatePwSubmit").onclick = go;
    document.getElementById("gatePwInput").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  };
  const go = async () => {
    const pw = document.getElementById("gatePwInput").value;
    try {
      await unlockAdminWith(pw);
      onSuccess();
    } catch (e) {
      render("Incorrect password.");
    }
  };
  render();
}

document.getElementById("genParentalBtn").onclick = async () => {
  const selectedCards = getCardsByState("selected");
  if (!selectedCards.length) {
    alert("No players are selected yet — pick your squad on the selection screen first.");
    return;
  }
  if (adminRoster) { openConsentPanel(selectedCards); return; }
  if (adminPassword) {
    try { await unlockAdminWith(adminPassword); openConsentPanel(selectedCards); return; }
    catch (e) { adminPassword = null; sessionStorage.removeItem("akram_admin_pw"); }
  }
  openAdminGateFor(() => openConsentPanel(selectedCards));
};

function openConsentPanel(selectedCards) {
  overlay.classList.remove("hidden");
  renderConsentPanel(selectedCards);
}

function renderConsentPanel(selectedCards) {
  modalBody.innerHTML = `
    <h2>Kebenaran Ibu Bapa</h2>
    <p class="sub">Choose Parent or Warden as the contact for each student, then generate — one page per student.</p>
    <div class="consent-list">
      ${selectedCards.map(card => {
        const choice = consentContact[card.id] || "parent";
        return `
          <div class="consent-row">
            <div class="consent-name">${card.nickname || card.name}<span class="consent-sub">${card.name}</span></div>
            <div class="consent-toggle" data-id="${card.id}">
              <button type="button" class="toggle-btn ${choice === "parent" ? "active" : ""}" data-choice="parent">Parent</button>
              <button type="button" class="toggle-btn ${choice === "warden" ? "active" : ""}" data-choice="warden">Warden</button>
            </div>
          </div>`;
      }).join("")}
    </div>
    <button class="submit" id="confirmGenerateConsent">Generate PDF (${selectedCards.length} student${selectedCards.length === 1 ? "" : "s"})</button>
  `;
  modalBody.querySelectorAll(".consent-toggle").forEach(group => {
    const id = group.dataset.id;
    group.querySelectorAll(".toggle-btn").forEach(btn => {
      btn.onclick = () => {
        consentContact[id] = btn.dataset.choice;
        saveConsentContact();
        group.querySelectorAll(".toggle-btn").forEach(b => b.classList.toggle("active", b === btn));
      };
    });
  });
  document.getElementById("confirmGenerateConsent").onclick = () => generateConsentDocuments(selectedCards);
}

function buildConsentStudentHTML(card, profile, contactType, tourney, todayDate, index, total) {
  const displayClass = classLabel(card);
  const contact = contactType === "warden"
    ? WARDEN_INFO
    : {
        name: (profile.guardian1Name || "....................................").toUpperCase(),
        address: (profile.address || "....................................").toUpperCase(),
        phone: profile.guardian1Phone || "....................................",
      };
  const dash = "....................................";

  return `
    <div class="consent-page">
      <div class="consent-header">
        <img class="consent-logo-left" src="assets/jata-negara.png" onerror="this.style.display='none'">
        <div class="consent-school-name">
          <p>${SCHOOL_NAME_LINES[0]}</p>
          <p>${SCHOOL_NAME_LINES[1]}</p>
          <p class="consent-contact-line">${SCHOOL_CONTACT_LINE}</p>
        </div>
        <img class="consent-logo-right" src="assets/logosmktm.png" onerror="this.style.display='none'">
      </div>
      <hr class="consent-rule">

      <div class="consent-recipient-row">
        <div>
          <p>Kepada,</p>
          <p><strong>${contact.name}</strong></p>
        </div>
        <div class="consent-date">Tarikh: ${todayDate}</div>
      </div>

      <p>Tuan/Puan,</p>
      <p><strong>PENYERTAAN PELAJAR DALAM PERTANDINGAN / LAWATAN AKTIVITI KOKURIKULUM.</strong></p>
      <p class="consent-justify">Berhubung dengan perkara di atas adalah dimaklumkan bahawa anak jagaan tuan/puan yang bernama <strong>${card.name}</strong> (Tingkatan <strong>${displayClass}</strong>) telah terpilih untuk mengambil bahagian dalam aktiviti berikut:</p>

      <table class="consent-activity-table">
        <thead><tr><th>Tarikh</th><th>Masa</th><th>Nama Aktiviti</th><th>Tempat</th></tr></thead>
        <tbody><tr>
          <td>${tourney.date || dash}</td>
          <td>${tourney.time || dash}</td>
          <td>${tourney.name || dash}</td>
          <td>${tourney.venue || dash}</td>
        </tr></tbody>
      </table>

      <p class="consent-teacher"><strong>Guru Pengiring: ${TEACHER_IN_CHARGE}</strong></p>
      <p>2. Para pelajar dikehendaki mematuhi peraturan yang telah ditetapkan oleh pihak sekolah.</p>
      <p>3. Pihak sekolah akan mengambil langkah-langkah keselamatan yang sewajarnya sebelum, semasa dan selepas aktiviti/program.</p>
      <p>4. Sila penuhkan dan kembalikan keratan jawapan yang berkenaan.</p>
      <p>Sekian, terima kasih.</p>
      <p class="consent-signature-line">${dash}</p>

      <div class="consent-cut-line"><span>POTONG DI SINI</span></div>

      <div class="consent-reply-row"><span class="consent-reply-label">Nama:</span><strong>${contact.name}</strong></div>
      <div class="consent-reply-row"><span class="consent-reply-label">Alamat:</span><span>${contact.address}</span></div>
      <div class="consent-reply-row"><span class="consent-reply-label">No. Tel:</span><span>${contact.phone}</span></div>

      <p class="consent-justify">Saya <strong>${contact.name}</strong> ibu/bapa/penjaga kepada pelajar <strong>${card.name}</strong> dari tingkatan ${displayClass}. Membenarkan / Tidak Membenarkan anak jagaan saya menghadiri aktiviti <strong>${tourney.name || dash}</strong> pada tarikh ${tourney.date || dash} dan memahami syarat-syarat yang dinyatakan.</p>

      <p>Yang benar,</p>
      <p class="consent-signature-line">${dash}</p>
      <p class="consent-signature-label">(${contact.name})</p>
      <p class="consent-date-small">Tarikh: ${todayDate}</p>
    </div>
  `;
}

function generateConsentDocuments(selectedCards) {
  const btn = document.getElementById("confirmGenerateConsent");
  if (btn) { btn.textContent = "Loading logos..."; btn.disabled = true; }

  const tourney = {
    name: document.getElementById("tournamentNameInput").value.trim(),
    date: formatDateRange(document.getElementById("tournamentStartDate").value, document.getElementById("tournamentEndDate").value),
    time: document.getElementById("tournamentTimeInput").value.trim(),
    venue: document.getElementById("venueInput").value.trim(),
  };
  const todayDate = formatDatePart(new Date().toISOString().slice(0, 10));

  const pagesHtml = selectedCards.map((card, i) => {
    const profile = adminRoster.find(p => p.id === card.id) || {};
    const contactType = consentContact[card.id] || "parent";
    return buildConsentStudentHTML(card, profile, contactType, tourney, todayDate, i, selectedCards.length);
  }).join("");

  const existing = document.getElementById("printArea");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "printArea";
  div.className = "print-only";
  div.innerHTML = pagesHtml;
  document.body.appendChild(div);

  // Wait for every logo image to actually finish loading (success or failure)
  // before printing — otherwise window.print() can fire before a large image
  // like the Jata Negara file has finished downloading, leaving it blank.
  const imgs = Array.from(div.querySelectorAll("img"));
  Promise.all(imgs.map(img => img.complete
    ? Promise.resolve()
    : new Promise(resolve => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      })
  )).then(() => {
    overlay.classList.add("hidden");
    window.print();
  });
}
// ---------- Document 3: Borang Kebenaran Media (KPM photo/video/social media consent) ----------
// This is the official KPM (Kementerian Pendidikan Malaysia) annual media
// consent form — wording below is transcribed verbatim from the government
// template and should not be paraphrased. Unlike Document 2, this is
// parent-only (no Warden option) and isn't tied to a specific tournament —
// it's a blanket consent valid for the current year, covering any
// program/activity run during it.

function buildMediaConsentStudentHTML(card, profile, year, todayDate) {
  const displayClass = classLabel(card);
  const blank = "....................................";
  const parentName = (profile.guardian1Name || "").toUpperCase();
  const parentIc = profile.guardian1Ic || "";
  const parentPhone = profile.guardian1Phone || "";
  const parentAddress = (profile.address || "").toUpperCase();
  const studentIc = profile.icNumber || "";
  const schoolAddress = `${SCHOOL_NAME_LINES[0]} ${SCHOOL_NAME_LINES[1]}`;

  // Page 1 — matches the original form's page 4 exactly: header through
  // "Alamat Institusi Pendidikan," nothing more.
  const page1 = `
    <div class="consent-page media-page">
      <div class="media-header">
        <img class="media-jata" src="assets/jata-negara.png" onerror="this.style.display='none'">
        <p class="media-ministry">KEMENTERIAN PENDIDIKAN</p>
      </div>
      <div class="media-title">
        <p>SURAT AKUAN IBU BAPA/PENJAGA</p>
        <p>UNTUK KEBENARAN RAKAMAN GAMBAR/VIDEO/AUDIO MURID SERTA</p>
        <p>MEMUAT NAIK KE LAMAN MEDIA SOSIAL BAGI PROGRAM ANJURAN</p>
        <p>INSTITUSI PENDIDIKAN BAWAH KEMENTERIAN PENDIDIKAN MALAYSIA</p>
        <p>BAGI TAHUN: <strong>${year}</strong></p>
      </div>
      <hr class="media-rule">

      <div class="media-field-row"><span class="media-label">Saya (Nama):</span><span class="media-value">${parentName || blank}</span></div>
      <div class="media-field-row"><span class="media-label">No. Kad Pengenalan:</span><span class="media-value">${parentIc || blank}</span></div>
      <div class="media-field-row"><span class="media-label">Beralamat:</span><span class="media-value">${parentAddress || blank}</span></div>
      <div class="media-field-row"><span class="media-label">No. telefon:</span><span class="media-value">${parentPhone || blank}</span></div>

      <p class="media-declare">mengaku ialah ibu/bapa/penjaga kepada murid bernama seperti di bawah:<br>(sila pilih mana yang berkenaan)</p>

      <div class="media-field-row"><span class="media-label">Nama murid:</span><span class="media-value">${card.name}</span></div>
      <div class="media-field-row"><span class="media-label">Tingkatan/Darjah/Lain-lain(sila nyatakan):</span><span class="media-value">${displayClass}</span></div>
      <div class="media-field-row"><span class="media-label">No. Kad Pengenalan/MyKid:</span><span class="media-value">${studentIc || blank}</span></div>
      <div class="media-field-row"><span class="media-label">Alamat Institusi Pendidikan:</span><span class="media-value">${schoolAddress}</span></div>
    </div>
  `;

  // Page 2 — matches the original form's page 5: no repeated header, starts
  // straight at "Saya dengan ini;"
  const page2 = `
    <div class="consent-page media-page">
      <p class="media-consent-intro">Saya dengan ini;</p>
      <p class="media-clause"><strong>(a)</strong> Bersetuju membenarkan pihak institusi pendidikan bawah KPM untuk mengambil rakaman gambar/video/audio anak/kanak-kanak jagaan saya bagi setiap program/majlis/aktiviti yang dilaksanakan sepanjang tahun ini; dan</p>
      <p class="media-clause"><strong>(b)</strong> Bersetuju membenarkan institusi pendidikan bawah KPM memuat naik rakaman gambar/video/audio anak/kanak-kanak jagaan saya di mana-mana platform seliaan institusi pendidikan bawah KPM.</p>
      <p class="media-clause"><strong>(c)</strong> Mengesahkan butiran yang diberikan adalah BENAR dan FAHAM dengan perkara yang dinyatakan pada bahagian (a) dan (b).</p>

      <p class="media-note-title">Nota:</p>
      <p class="media-note">1. KPM – Kementerian Pendidikan Malaysia</p>
      <p class="media-note">2. Institusi pendidikan bawah KPM termasuk bahagian KPM, jabatan pendidikan negeri dan pejabat pendidikan daerah.</p>

      <div class="media-field-row"><span class="media-label">Tandatangan Ibu bapa/Penjaga:</span><span class="media-value">${blank}</span></div>
      <div class="media-field-row"><span class="media-label">Nama Penuh (Huruf Besar):</span><span class="media-value">${parentName || blank}</span></div>
      <div class="media-field-row"><span class="media-label">Tarikh:</span><span class="media-value">${todayDate}</span></div>

      <p class="media-guru-title">DISAHKAN OLEH GURU KELAS</p>
      <p class="media-declare">Saya dengan ini memperakui bahawa ibu bapa/penjaga murid seperti yang dinyatakan telah menandatangani borang ini bagi tujuan di atas.</p>

      <div class="media-field-row"><span class="media-label">Tandatangan:</span><span class="media-value">${blank}</span></div>
      <div class="media-field-row"><span class="media-label">Nama Penuh (Huruf Besar):</span><span class="media-value">${blank}</span></div>
      <div class="media-field-row"><span class="media-label">Tarikh:</span><span class="media-value">${blank}</span></div>
      <div class="media-field-row"><span class="media-label">Cap Rasmi Sekolah:</span><span class="media-value">${blank}</span></div>
    </div>
  `;

  return page1 + page2;
}

function generateMediaConsentDocuments(selectedCards) {
  const year = new Date().getFullYear();
  const todayDate = formatDatePart(new Date().toISOString().slice(0, 10));

  const pagesHtml = selectedCards.map(card => {
    const profile = adminRoster.find(p => p.id === card.id) || {};
    return buildMediaConsentStudentHTML(card, profile, year, todayDate);
  }).join("");

  const existing = document.getElementById("printArea");
  if (existing) existing.remove();
  const div = document.createElement("div");
  div.id = "printArea";
  div.className = "print-only";
  div.innerHTML = pagesHtml;
  document.body.appendChild(div);

  const imgs = Array.from(div.querySelectorAll("img"));
  Promise.all(imgs.map(img => img.complete
    ? Promise.resolve()
    : new Promise(resolve => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      })
  )).then(() => {
    overlay.classList.add("hidden");
    window.print();
  });
}

document.getElementById("genMediaBtn").onclick = async () => {
  const selectedCards = getCardsByState("selected");
  if (!selectedCards.length) {
    alert("No players are selected yet — pick your squad on the selection screen first.");
    return;
  }
  if (adminRoster) { generateMediaConsentDocuments(selectedCards); return; }
  if (adminPassword) {
    try { await unlockAdminWith(adminPassword); generateMediaConsentDocuments(selectedCards); return; }
    catch (e) { adminPassword = null; sessionStorage.removeItem("akram_admin_pw"); }
  }
  openAdminGateFor(() => generateMediaConsentDocuments(selectedCards));
};
// Document 4 (M01) is intentionally a disabled placeholder for now — see
// the `disabled` attribute on its button in index.html.

loadCards();

// Add a shadow to the sticky filter bar once it's actually pinned to the top
const controlsEl = document.querySelector(".controls");
if (controlsEl && "IntersectionObserver" in window) {
  const sentinel = document.createElement("div");
  controlsEl.before(sentinel);
  new IntersectionObserver(
    ([entry]) => controlsEl.classList.toggle("is-stuck", !entry.isIntersecting),
    { threshold: 0 }
  ).observe(sentinel);
}
