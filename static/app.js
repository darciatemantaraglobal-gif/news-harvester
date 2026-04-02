// app.js — Frontend logic untuk News Scraper dashboard

let allArticles = [];
let pollTimer = null;

// ─── Validasi URL ──────────────────────────────────
function validateUrl(url) {
  if (!url || !url.trim()) return "URL tidak boleh kosong.";
  try {
    const u = new URL(url.trim());
    if (!["http:", "https:"].includes(u.protocol)) return "URL harus dimulai dengan http:// atau https://";
  } catch {
    return "Format URL tidak valid.";
  }
  return null;
}

// ─── Start Scrape ──────────────────────────────────
async function startScrape() {
  const input = document.getElementById("url-input");
  const errEl = document.getElementById("url-error");
  const url = input.value.trim();

  // Validasi
  const err = validateUrl(url);
  if (err) {
    errEl.textContent = err;
    errEl.classList.remove("hidden");
    input.classList.add("border-red-400", "ring-red-200");
    return;
  }
  errEl.classList.add("hidden");
  input.classList.remove("border-red-400", "ring-red-200");

  // Disable button
  const btn = document.getElementById("btn-scrape");
  btn.disabled = true;
  btn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg> Scraping...`;

  // Show progress
  document.getElementById("progress-section").classList.remove("hidden");
  document.getElementById("log-panel").innerHTML = "";

  try {
    const resp = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      addLog("❌ " + (data.error || "Gagal memulai scraping"));
      resetBtn();
      return;
    }
    addLog("🚀 Scraping dimulai...");
    startPolling();
  } catch (e) {
    addLog("❌ Network error: " + e.message);
    resetBtn();
  }
}

// ─── Polling Progress ──────────────────────────────
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  let lastLogCount = 0;

  pollTimer = setInterval(async () => {
    try {
      const resp = await fetch("/api/progress");
      const d = await resp.json();

      // Update stats
      document.getElementById("stat-total").textContent = d.total || 0;
      document.getElementById("stat-success").textContent = d.success || 0;
      document.getElementById("stat-partial").textContent = d.partial || 0;
      document.getElementById("stat-failed").textContent = d.failed || 0;

      // Update progress bar
      const pct = d.total > 0 ? Math.round((d.current / d.total) * 100) : 0;
      document.getElementById("progress-bar").style.width = pct + "%";
      document.getElementById("progress-pct").textContent = pct + "%";

      if (d.phase === "listing") {
        document.getElementById("progress-label").textContent = "Mengumpulkan link artikel...";
      } else if (d.phase === "scraping") {
        document.getElementById("progress-label").textContent = `Scraping artikel ${d.current}/${d.total}`;
      } else if (d.phase === "done") {
        document.getElementById("progress-label").textContent = "Selesai!";
        document.getElementById("progress-bar").style.width = "100%";
        document.getElementById("progress-pct").textContent = "100%";
      }

      // Update logs (hanya log baru)
      if (d.logs && d.logs.length > lastLogCount) {
        for (let i = lastLogCount; i < d.logs.length; i++) {
          addLog(d.logs[i]);
        }
        lastLogCount = d.logs.length;
      }

      // Selesai?
      if (!d.running && d.phase === "done") {
        clearInterval(pollTimer);
        pollTimer = null;
        resetBtn();
        loadArticles();
      }
    } catch (e) {
      // ignore polling errors
    }
  }, 1000);
}

// ─── Log Panel ─────────────────────────────────────
function addLog(msg) {
  const panel = document.getElementById("log-panel");
  const line = document.createElement("div");
  const time = new Date().toLocaleTimeString("id-ID");
  line.innerHTML = `<span class="text-slate-400">[${time}]</span> ${escapeHtml(msg)}`;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

// ─── Reset Button ──────────────────────────────────
function resetBtn() {
  const btn = document.getElementById("btn-scrape");
  btn.disabled = false;
  btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Start Scraping`;
}

// ─── Load & Render Articles ────────────────────────
async function loadArticles() {
  try {
    const resp = await fetch("/api/articles");
    allArticles = await resp.json();
    renderArticles(allArticles);
  } catch (e) {
    console.error("Failed to load articles", e);
  }
}

function renderArticles(articles) {
  const tbody = document.getElementById("articles-table");
  const empty = document.getElementById("empty-state");

  if (!articles.length) {
    tbody.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  tbody.innerHTML = articles.map((a, i) => {
    const preview = (a.content || "").substring(0, 200) + ((a.content || "").length > 200 ? "..." : "");
    const badgeClass = a.status === "success" ? "badge-success" : a.status === "partial" ? "badge-partial" : "badge-failed";
    return `<tr class="hover:bg-slate-50 transition">
      <td class="px-4 py-3 text-slate-500">${i + 1}</td>
      <td class="px-4 py-3 font-medium text-slate-900 max-w-xs truncate">${escapeHtml(a.title || "(Tanpa Judul)")}</td>
      <td class="px-4 py-3 text-slate-500 whitespace-nowrap">${escapeHtml(a.date || "-")}</td>
      <td class="px-4 py-3 text-slate-500 text-xs max-w-sm"><div class="line-clamp-2">${escapeHtml(preview)}</div></td>
      <td class="px-4 py-3"><span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass}">${a.status.toUpperCase()}</span></td>
      <td class="px-4 py-3"><a href="/article/${a.id}" class="text-indigo-600 hover:text-indigo-800 text-xs font-medium hover:underline">Lihat Detail</a></td>
    </tr>`;
  }).join("");
}

// ─── Search / Filter ───────────────────────────────
function filterArticles() {
  const q = document.getElementById("search-input").value.toLowerCase().trim();
  if (!q) {
    renderArticles(allArticles);
    return;
  }
  const filtered = allArticles.filter(a => (a.title || "").toLowerCase().includes(q));
  renderArticles(filtered);
}

// ─── Init ──────────────────────────────────────────
document.addEventListener("DOMContentLoaded", loadArticles);
