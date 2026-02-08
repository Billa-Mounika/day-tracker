/* Day Timeline Tracker - Offline-first PWA (iPhone-friendly)
   - Tap category to start/switch (only one running)
   - Rest is a category button
   - Timeline + edit blocks
   - Idle + wind-up reminders (best when installed as PWA)
*/

const CATEGORIES = [
  { id: "work", name: "Work" },
  { id: "cooking", name: "Cooking" },
  { id: "commute", name: "Commute" },
  { id: "kids", name: "Kids" },
  { id: "study", name: "Study" },
  { id: "rest", name: "Rest", cls: "rest" },
  { id: "exercise", name: "Exercise" },
  { id: "social", name: "Social" },
];

const $ = (id) => document.getElementById(id);

const db = new Dexie("DayTimelineTracker");
db.version(1).stores({
  logs: "++id,categoryId,startTs,endTs,dayKey",
  settings: "key",
});

function dayKeyFrom(ts) {
  const d = new Date(ts);
  // local day key YYYY-MM-DD
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtRange(startTs, endTs) {
  if (!endTs) return `${fmtTime(startTs)} → now`;
  return `${fmtTime(startTs)} – ${fmtTime(endTs)}`;
}

function minutesBetween(a, b) {
  return Math.max(0, Math.round((b - a) / 60000));
}

function toLocalDatetimeInputValue(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function fromLocalDatetimeInputValue(val) {
  // val: YYYY-MM-DDTHH:MM in local time
  const d = new Date(val);
  return d.getTime();
}

// UI elements
const grid = $("categoryGrid");
const timelineList = $("timelineList");
const currentActivity = $("currentActivity");
const currentSince = $("currentSince");
const notifStatus = $("notifStatus");

const idleMinutesSel = $("idleMinutes");
const windupTimeInput = $("windupTime");
const remindersEnabledToggle = $("remindersEnabled");

const noteDialog = $("noteDialog");
const noteText = $("noteText");
const btnSaveNote = $("btnSaveNote");

const editDialog = $("editDialog");
const editId = $("editId");
const editCategory = $("editCategory");
const editStart = $("editStart");
const editEnd = $("editEnd");
const editNote = $("editNote");
const btnSaveEdit = $("btnSaveEdit");
const btnDeleteBlock = $("btnDeleteBlock");

let reminderTimers = { idle: null, windup: null, ticker: null };
let lastSwitchAt = Date.now();
let lastReminderAt = 0;

function setNotifStatus() {
  if (!("Notification" in window)) {
    notifStatus.textContent = "Not supported";
    return;
  }
  notifStatus.textContent = Notification.permission;
}

async function loadSettings() {
  const defaults = {
    idleMinutes: 30,
    windupTime: "21:45",
    remindersEnabled: true,
  };
  const rows = await db.settings.toArray();
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const merged = { ...defaults, ...s };

  idleMinutesSel.value = String(merged.idleMinutes);
  windupTimeInput.value = merged.windupTime;
  remindersEnabledToggle.checked = !!merged.remindersEnabled;

  return merged;
}

async function saveSetting(key, value) {
  await db.settings.put({ key, value });
}

function buildGrid() {
  grid.innerHTML = "";
  for (const c of CATEGORIES) {
    const btn = document.createElement("div");
    btn.className = `cat ${c.cls || ""}`;
    btn.textContent = c.name;
    btn.dataset.cat = c.id;
    btn.addEventListener("click", () => startOrSwitch(c.id));
    grid.appendChild(btn);
  }
}

function setActiveButton(catId) {
  for (const el of grid.querySelectorAll(".cat")) {
    const active = el.dataset.cat === catId;
    el.classList.toggle("active", active);
  }
}

async function getRunningLog() {
  return db.logs.where("endTs").equals(null).first();
}

async function startOrSwitch(categoryId) {
  const now = Date.now();
  const running = await getRunningLog();

  // If already running same category: no-op (but update lastSwitchAt for idle logic)
  if (running && running.categoryId === categoryId) {
    lastSwitchAt = now;
    render();
    return;
  }

  // Close previous if any
  if (running) {
    await db.logs.update(running.id, { endTs: now });
  }

  // Create new
  await db.logs.add({
    categoryId,
    startTs: now,
    endTs: null,
    note: "",
    dayKey: dayKeyFrom(now),
  });

  lastSwitchAt = now;
  render();
}

async function stopTracking() {
  const now = Date.now();
  const running = await getRunningLog();
  if (running) {
    await db.logs.update(running.id, { endTs: now });
  }
  lastSwitchAt = now;
  render();
}

async function addNoteToLatest(note) {
  const running = await getRunningLog();
  if (running) {
    await db.logs.update(running.id, { note });
    return;
  }
  // If nothing running, attach to latest today
  const today = dayKeyFrom(Date.now());
  const latest = await db.logs.where("dayKey").equals(today).reverse().sortBy("startTs");
  const last = latest[0];
  if (last) await db.logs.update(last.id, { note });
}

async function loadTodayLogs() {
  const today = dayKeyFrom(Date.now());
  const logs = await db.logs.where("dayKey").equals(today).sortBy("startTs");
  return logs;
}

function catName(id) {
  return (CATEGORIES.find(c => c.id === id) || {}).name || id;
}

async function renderCurrent() {
  const running = await getRunningLog();
  if (!running) {
    currentActivity.textContent = "—";
    currentSince.textContent = "Not tracking";
    setActiveButton(null);
    return;
  }
  currentActivity.textContent = catName(running.categoryId);
  currentSince.textContent = `Since ${fmtTime(running.startTs)}`;
  setActiveButton(running.categoryId);
}

async function renderTimeline() {
  const logs = await loadTodayLogs();
  const now = Date.now();

  if (!logs.length) {
    timelineList.innerHTML = `<div class="help"><b>No entries yet.</b><div class="small muted">Tap a category to start tracking.</div></div>`;
    return;
  }

  timelineList.innerHTML = "";
  for (const log of logs) {
    const endTs = log.endTs || now;
    const mins = minutesBetween(log.startTs, endTs);

    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div class="left">
        <div class="catname">${catName(log.categoryId)}</div>
        <div class="meta">${fmtRange(log.startTs, log.endTs)} • ${mins} min</div>
        ${log.note ? `<div class="note">📝 ${escapeHtml(log.note)}</div>` : ""}
      </div>
      <div class="right">
        ${log.endTs ? `<span class="pill ok">Done</span>` : `<span class="pill warn">Running</span>`}
        <button class="btn secondary" data-edit="${log.id}">Edit</button>
      </div>
    `;
    item.querySelector("[data-edit]").addEventListener("click", () => openEdit(log.id));
    timelineList.appendChild(item);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

async function renderStats() {
  const logs = await loadTodayLogs();
  const now = Date.now();
  const totals = new Map();
  let tracked = 0;

  for (const log of logs) {
    const endTs = log.endTs || now;
    const mins = minutesBetween(log.startTs, endTs);
    tracked += mins;
    totals.set(log.categoryId, (totals.get(log.categoryId) || 0) + mins);
  }

  const statBox = $("statsBox");
  statBox.innerHTML = "";

  const totalCard = document.createElement("div");
  totalCard.className = "statcard";
  totalCard.innerHTML = `<h4>Today</h4>
    <div class="statline"><span>Total tracked</span><span>${tracked} min</span></div>
    <div class="statline"><span>Untracked (approx)</span><span>${Math.max(0, 1440 - tracked)} min</span></div>`;
  statBox.appendChild(totalCard);

  const byCat = document.createElement("div");
  byCat.className = "statcard";
  byCat.innerHTML = `<h4>By category</h4>`;
  const sorted = [...totals.entries()].sort((a,b) => b[1]-a[1]);
  if (!sorted.length) {
    byCat.innerHTML += `<div class="small muted">No data yet.</div>`;
  } else {
    for (const [cat, mins] of sorted) {
      const pct = tracked ? Math.round((mins / tracked) * 100) : 0;
      byCat.innerHTML += `<div class="statline"><span>${catName(cat)}</span><span>${mins} min • ${pct}%</span></div>`;
    }
  }
  statBox.appendChild(byCat);
}

async function render() {
  await renderCurrent();
  await renderTimeline();
  await renderStats();
}

async function openEdit(id) {
  const log = await db.logs.get(id);
  if (!log) return;

  editId.value = String(log.id);
  editCategory.innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
  editCategory.value = log.categoryId;

  const now = Date.now();
  editStart.value = toLocalDatetimeInputValue(log.startTs);
  editEnd.value = toLocalDatetimeInputValue(log.endTs || now);
  editNote.value = log.note || "";

  editDialog.showModal();
}

async function saveEdit() {
  const id = Number(editId.value);
  const startTs = fromLocalDatetimeInputValue(editStart.value);
  const endTs = fromLocalDatetimeInputValue(editEnd.value);
  const categoryId = editCategory.value;
  const note = editNote.value || "";

  if (!(startTs && endTs) || endTs <= startTs) {
    alert("End must be after Start.");
    return;
  }

  const dayKey = dayKeyFrom(startTs);
  await db.logs.update(id, { startTs, endTs, categoryId, note, dayKey });

  render();
}

async function deleteBlock() {
  const id = Number(editId.value);
  await db.logs.delete(id);
  render();
}

async function clearToday() {
  if (!confirm("Clear all today's entries?")) return;
  const today = dayKeyFrom(Date.now());
  const ids = await db.logs.where("dayKey").equals(today).primaryKeys();
  await db.logs.bulkDelete(ids);
  render();
}

function switchTab(tabName) {
  for (const b of document.querySelectorAll(".tab")) {
    b.classList.toggle("active", b.dataset.tab === tabName);
  }
  for (const p of document.querySelectorAll(".tabpane")) {
    p.classList.remove("show");
  }
  $("tab-" + tabName).classList.add("show");
}

/* ---------------- Reminders ----------------
   Without a server, we do "local reminders" while the app is running.
   If you later add a push server (VAPID), the Service Worker has a push handler already.
*/

function cancelReminderTimers() {
  if (reminderTimers.idle) clearInterval(reminderTimers.idle);
  if (reminderTimers.windup) clearTimeout(reminderTimers.windup);
  if (reminderTimers.ticker) clearInterval(reminderTimers.ticker);
  reminderTimers = { idle: null, windup: null, ticker: null };
}

async function notify(title, body, data = {}) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  // best effort
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) {
      await reg.showNotification(title, {
        body,
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        data
      });
      return;
    }
  } catch(e) {}
  // fallback
  new Notification(title, { body });
}

async function scheduleRemindersFromUI() {
  const enabled = remindersEnabledToggle.checked;
  await saveSetting("remindersEnabled", enabled);

  await saveSetting("idleMinutes", Number(idleMinutesSel.value));
  await saveSetting("windupTime", windupTimeInput.value);

  cancelReminderTimers();
  setNotifStatus();

  if (!enabled) return;

  // idle reminder check
  reminderTimers.idle = setInterval(async () => {
    const idleMinutes = Number(idleMinutesSel.value);
    const now = Date.now();

    // remind always (even if Rest) - but avoid spamming: one reminder per idle window
    const minsSinceSwitch = minutesBetween(lastSwitchAt, now);
    if (minsSinceSwitch >= idleMinutes) {
      // throttle: only once every idleMinutes/2, min 10
      const throttle = Math.max(10, Math.floor(idleMinutes / 2));
      if (minutesBetween(lastReminderAt, now) >= throttle) {
        const running = await getRunningLog();
        const label = running ? catName(running.categoryId) : "nothing";
        await notify("Day Tracker", `Still doing: ${label}?`, { type: "idle", running: running ? running.categoryId : null });
        lastReminderAt = now;
      }
    }
  }, 30 * 1000);

  // wind-up scheduler: schedule next occurrence
  scheduleNextWindup();
}

function scheduleNextWindup() {
  if (!remindersEnabledToggle.checked) return;

  const t = windupTimeInput.value || "21:45";
  const [hh, mm] = t.split(":").map(Number);
  const now = new Date();

  const next = new Date();
  next.setHours(hh, mm, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  const ms = next.getTime() - now.getTime();
  reminderTimers.windup = setTimeout(async () => {
    await notify("Day Tracker", "Wind up your day: review your timeline.", { type: "windup" });
    // reschedule for next day
    scheduleNextWindup();
  }, ms);
}

async function enableReminders() {
  if (!("Notification" in window)) {
    alert("Notifications are not supported on this device/browser.");
    return;
  }
  const perm = await Notification.requestPermission();
  setNotifStatus();
  if (perm !== "granted") {
    alert("Notifications not allowed. You can enable them in iPhone Settings → Notifications.");
    return;
  }
  // Ensure SW ready for showNotification
  try {
    await navigator.serviceWorker.ready;
  } catch(e) {}
  await scheduleRemindersFromUI();
}

/* -------- Wind-up screen (simple) -------- */
async function windupNow() {
  // just switch to timeline tab and pop totals
  switchTab("timeline");
  const stats = $("statsBox");
  await renderStats();
  // also show an alert summary
  const logs = await loadTodayLogs();
  const now = Date.now();
  const totals = {};
  for (const log of logs) {
    const endTs = log.endTs || now;
    const mins = minutesBetween(log.startTs, endTs);
    totals[catName(log.categoryId)] = (totals[catName(log.categoryId)] || 0) + mins;
  }
  const lines = Object.entries(totals).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `${k}: ${v} min`);
  alert("Wind-up summary\n\n" + (lines.length ? lines.join("\n") : "No data yet."));
}

/* -------- Export -------- */
async function exportJSON() {
  const logs = await loadTodayLogs();
  const payload = { date: dayKeyFrom(Date.now()), logs };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `day-tracker-${payload.date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* -------- Install help -------- */
function showInstallHelp() {
  switchTab("settings");
}

/* -------- init -------- */
async function init() {
  buildGrid();
  setNotifStatus();

  // Populate edit category select
  editCategory.innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join("");

  // Load settings
  await loadSettings();

  // Tabs
  for (const b of document.querySelectorAll(".tab")) {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  }

  // Actions
  $("btnStop").addEventListener("click", stopTracking);
  $("btnNote").addEventListener("click", () => { noteText.value = ""; noteDialog.showModal(); });
  btnSaveNote.addEventListener("click", async (e) => {
    e.preventDefault();
    await addNoteToLatest(noteText.value.trim());
    noteDialog.close();
    render();
  });

  btnSaveEdit.addEventListener("click", async (e) => {
    e.preventDefault();
    await saveEdit();
    editDialog.close();
  });

  btnDeleteBlock.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!confirm("Delete this block?")) return;
    await deleteBlock();
    editDialog.close();
  });

  $("btnEnable").addEventListener("click", enableReminders);
  $("btnInstallHelp").addEventListener("click", showInstallHelp);

  idleMinutesSel.addEventListener("change", scheduleRemindersFromUI);
  windupTimeInput.addEventListener("change", scheduleRemindersFromUI);
  remindersEnabledToggle.addEventListener("change", scheduleRemindersFromUI);

  $("btnWindupNow").addEventListener("click", windupNow);
  $("btnExport").addEventListener("click", exportJSON);
  $("btnClearToday").addEventListener("click", clearToday);

  // Register Service Worker
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
    } catch (e) {
      console.warn("SW registration failed", e);
    }
  }

  // Render initial
  await render();

  // update "running" timer label every 15 seconds
  reminderTimers.ticker = setInterval(renderCurrent, 15000);

  // Schedule reminders (if already granted)
  if ("Notification" in window && Notification.permission === "granted") {
    await scheduleRemindersFromUI();
  }

  // Listen for notification click messages (from SW)
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const msg = event.data || {};
      if (msg.type === "notif_click") {
        // bring user to timeline
        switchTab("timeline");
      }
    });
  }
}

init();
