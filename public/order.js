// ===== Splash logic (ALWAYS show on refresh) =====
const splashEl = document.getElementById("splash");
const appEl = document.getElementById("app");
const enterBtn = document.getElementById("enterBtn");

function showApp() {
  if (!splashEl || !appEl) return;

  splashEl.classList.add("fade-out");
  setTimeout(() => {
    splashEl.remove(); // 移除封面
  }, 250);

  appEl.classList.remove("hidden");
  appEl.classList.add("fade-in");
}

function initSplash() {
  // 兜底：元素不全就直接显示 app，别卡死
  if (!splashEl || !appEl || !enterBtn) {
    console.warn("[Splash] missing elements", { splashEl, appEl, enterBtn });
    appEl?.classList.remove("hidden");
    return;
  }

  // ✅ 每次刷新都强制：显示封面、隐藏 app
  splashEl.classList.remove("hidden");
  appEl.classList.add("hidden");

  // 防止重复绑定（热更新/重复加载时）
  enterBtn.onclick = null;
  splashEl.onclick = null;

  enterBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showApp();
  });

  // 点击黑色遮罩空白处也进入（可选）
  splashEl.addEventListener("click", (e) => {
    if (e.target === splashEl) showApp();
  });
}

initSplash();


const menuEl = document.getElementById("menu");
const whoEl = document.getElementById("who");
const noteEl = document.getElementById("note");
const msgEl = document.getElementById("msg");
const submitBtn = document.getElementById("submit");
const clearBtn = document.getElementById("clear");

// ✅ 新增：搜索/筛选/排序
const qEl = document.getElementById("q");
const tagBarEl = document.getElementById("tagBar");
const sortEl = document.getElementById("sort");

// ===== Summary / Chosen UI（你已有的）=====
const summaryBar = document.getElementById("summaryBar");
const sumKindsEl = document.getElementById("sumKinds");
const sumQtyEl = document.getElementById("sumQty");
const sumTextEl = document.getElementById("sumText");

const toggleChosenBtn = document.getElementById("toggleChosen");
const chosenPanel = document.getElementById("chosenPanel");
const chosenListEl = document.getElementById("chosenList");
const closeChosenBtn = document.getElementById("closeChosen");

// 你 HTML 里 submit2/submit3/clear2 可能用脚本桥接了，这里不强依赖
const submit2Btn = document.getElementById("submit2");
const submit3Btn = document.getElementById("submit3");
const clear2Btn = document.getElementById("clear2");

let menu = [];
let qtyMap = new Map(); // id(string) -> qty(number)

// ✅ 常点统计：id -> count
const FREQ_KEY = "ORDER_FREQ_MAP";
let freqMap = loadFreqMap();

// ✅ 当前筛选状态
let activeTag = "ALL";
let queryText = "";

function setMsg(text, ok = true) {
  if (!msgEl) return;
  msgEl.textContent = text;
  msgEl.style.color = ok ? "#16a34a" : "#dc2626";
}

function setSubmitting(v) {
  if (submitBtn) {
    submitBtn.disabled = v;
    submitBtn.textContent = v ? "提交中..." : "提交订单";
  }
  if (clearBtn) clearBtn.disabled = v;
  if (whoEl) whoEl.disabled = v;
  if (noteEl) noteEl.disabled = v;
}

function saveWho() {
  if (!whoEl) return;
  localStorage.setItem("ORDER_WHO", whoEl.value.trim());
}
function loadWho() {
  if (!whoEl) return;
  whoEl.value = localStorage.getItem("ORDER_WHO") || "";
}

async function loadMenu() {
  try {
    setMsg("正在加载菜单...", true);
    const res = await fetch("/api/menu");
    const data = await res.json();
    menu = Array.isArray(data.menu) ? data.menu : [];
    buildTagBar();
    applyFilterAndRender(); // 再按当前筛选渲染
    updateSummary();
    setMsg("菜单已加载 ✅", true);
  } catch (e) {
    setMsg(`菜单加载失败：${e?.message || "unknown error"}`, false);
  }
}

/** ====== 过滤/排序 ====== */
function getAllTags() {
  const set = new Set();
  for (const m of menu) {
    for (const t of (m.tags || [])) set.add(String(t));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function buildTagBar() {
  if (!tagBarEl) return;
  const tags = getAllTags();
  const buttons = ["ALL", ...tags];

  tagBarEl.innerHTML = buttons.map(t => {
    const label = t === "ALL" ? "全部" : escapeHtml(t);
    return `<button class="ghost tagbtn" data-tag="${escapeHtml(t)}" style="padding:8px 12px; border-radius:999px;">${label}</button>`;
  }).join("");

  // 默认高亮
  highlightActiveTag();
}

function highlightActiveTag() {
  if (!tagBarEl) return;
  tagBarEl.querySelectorAll(".tagbtn").forEach(btn => {
    const t = btn.getAttribute("data-tag");
    btn.classList.toggle("active", t === activeTag);
  });
}


function getFilteredMenu() {
  const q = (queryText || "").trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  let arr = menu.filter(m => {
    const name = String(m.name || "").toLowerCase();
    const okQ = tokens.length === 0 || tokens.every(t => name.includes(t));
    const okTag = (activeTag === "ALL") || (m.tags || []).map(String).includes(activeTag);
    return okQ && okTag;
  });

  const sort = sortEl?.value || "DEFAULT";
  if (sort === "NAME") {
    arr.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-Hans-CN"));
  } else if (sort === "FREQ") {
    arr.sort((a, b) => (getFreq(String(b.id)) - getFreq(String(a.id))) || String(a.name).localeCompare(String(b.name), "zh-Hans-CN"));
  }
  return arr;
}

/** ====== 渲染菜单（不卡：只渲染可见列表） ====== */
function applyFilterAndRender() {
  if (!menuEl) return;

  const filtered = getFilteredMenu();
  if (!filtered.length) {
    menuEl.innerHTML = `<div class="muted">没有匹配的菜</div>`;
    return;
  }

  menuEl.innerHTML = filtered.map((m) => {
    const id = String(m.id);
    const qty = qtyMap.get(id) || 0;

    const tagsHtml = (m.tags || [])
      .map((t) => `<span class="badge">${escapeHtml(t)}</span>`)
      .join("");

    const hot = getFreq(id);
    const hotHtml = hot > 0
      ? `<span class="badge hot">常点 ${hot}</span>`
      : "";

    // ✅ qty>0 时加 selected，让卡片高亮
    const selectedClass = qty > 0 ? "selected" : "";

    return `
      <div class="item ${selectedClass}" data-id="${escapeHtml(id)}">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
          <div style="min-width:0;">
            <div class="titleRow">
              <span class="name">${escapeHtml(m.name)}</span>
              ${hotHtml}
              ${tagsHtml}
            </div>
            <div class="meta">ID: ${escapeHtml(id)}</div>
          </div>

          <div class="stepper">
            <button data-action="dec" data-id="${escapeHtml(id)}" ${qty <= 0 ? "disabled" : ""}>−</button>
            <div class="qty">${qty}</div>
            <button data-action="inc" data-id="${escapeHtml(id)}" ${qty >= 9 ? "disabled" : ""}>+</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}


/** 只更新某一道菜的 qty 显示 + 按钮 disabled 状态（用于清空/联动） */
function updateRow(id) {
  if (!menuEl) return;
  const row = menuEl.querySelector(`.item[data-id="${cssEscape(id)}"]`);
  if (!row) return;

  const qty = qtyMap.get(id) || 0;

  // ✅ 卡片选中态
  row.classList.toggle("selected", qty > 0);

  const qtyEl = row.querySelector(".qty");
  if (qtyEl) qtyEl.textContent = String(qty);

  const decBtn = row.querySelector(`button[data-action="dec"][data-id="${cssEscape(id)}"]`);
  const incBtn = row.querySelector(`button[data-action="inc"][data-id="${cssEscape(id)}"]`);
  if (decBtn) decBtn.disabled = qty <= 0;
  if (incBtn) incBtn.disabled = qty >= 9;
}

function getChosenItems() {
  return menu
    .map((m) => {
      const id = String(m.id);
      const qty = qtyMap.get(id) || 0;
      if (qty <= 0) return null;
      return { id: m.id, name: m.name, qty };
    })
    .filter(Boolean);
}

function updateSummary() {
  if (!summaryBar || !sumKindsEl || !sumQtyEl || !sumTextEl) return;

  const chosen = getChosenItems();
  const kinds = chosen.length;
  const totalQty = chosen.reduce((s, x) => s + (x.qty || 0), 0);

  sumKindsEl.textContent = String(kinds);
  sumQtyEl.textContent = String(totalQty);

  if (kinds === 0) {
    sumTextEl.textContent = "暂无选择";
    summaryBar.classList.add("hidden");
    return;
  }

  const preview = chosen.slice(0, 3).map(x => `${x.name}×${x.qty}`).join("、");
  sumTextEl.textContent = chosen.length > 3 ? `${preview} 等` : preview;
  summaryBar.classList.remove("hidden");
}

/** ====== 已选清单（弹窗） ====== */
function renderChosenList() {
  if (!chosenListEl) return;
  const chosen = getChosenItems();
  if (!chosen.length) {
    chosenListEl.innerHTML = `<div class="muted" style="padding:10px 0;">暂无选择</div>`;
    return;
  }

  chosenListEl.innerHTML = chosen.map(x => `
    <div class="chosen-row" data-id="${escapeHtml(String(x.id))}">
      <div class="chosen-name">${escapeHtml(x.name)}</div>
      <div class="chosen-actions">
        <button class="ghost" data-action="dec" style="padding:6px 10px;">-</button>
        <div style="min-width:26px; text-align:center; font-weight:800;">${x.qty}</div>
        <button class="ghost" data-action="inc" style="padding:6px 10px;">+</button>
      </div>
    </div>
  `).join("");
}

function openChosen() {
  if (!chosenPanel) return;
  renderChosenList();
  chosenPanel.classList.remove("hidden");
}
function closeChosen() {
  if (!chosenPanel) return;
  chosenPanel.classList.add("hidden");
}

// 清单里的 +/-（事件委托）
chosenListEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const row = btn.closest(".chosen-row");
  if (!row) return;

  const id = String(row.getAttribute("data-id") || "");
  const action = btn.getAttribute("data-action");

  const cur = qtyMap.get(id) || 0;
  const next = action === "inc" ? Math.min(cur + 1, 9) : Math.max(cur - 1, 0);

  qtyMap.set(id, next);

  // 同步菜单那一行 + 汇总 + 清单
  updateRow(id);
  updateSummary();
  renderChosenList();
});

/** ====== 事件绑定 ====== */

// 菜单 +/-（事件委托）
menuEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || btn.disabled) return;

  const id = String(btn.getAttribute("data-id") || "");
  const action = btn.getAttribute("data-action");

  const cur = qtyMap.get(id) || 0;
  const next = action === "inc" ? Math.min(cur + 1, 9) : Math.max(cur - 1, 0);

  qtyMap.set(id, next);
  updateRow(id);
  updateSummary();
});

// Tag 点击
tagBarEl?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-tag]");
  if (!btn) return;
  activeTag = btn.getAttribute("data-tag") || "ALL";
  highlightActiveTag();
  applyFilterAndRender();
  // 过滤后，已经选的 qty 不会丢，只是隐藏/显示而已
});

// 搜索输入
qEl?.addEventListener("input", () => {
  queryText = qEl.value || "";
  applyFilterAndRender();
});

// 排序变化
sortEl?.addEventListener("change", () => {
  applyFilterAndRender();
});

// 清空
clearBtn?.addEventListener("click", () => {
  if (submitBtn?.disabled) return;

  qtyMap.clear();
  if (noteEl) noteEl.value = "";
  setMsg("已清空。");

  applyFilterAndRender(); // 当前视图重新渲染
  updateSummary();
  renderChosenList();
});

// 保存 who
whoEl?.addEventListener("input", saveWho);

// 汇总条按钮
toggleChosenBtn?.addEventListener("click", openChosen);
closeChosenBtn?.addEventListener("click", closeChosen);


// 回车提交：who Enter 提交；备注 Ctrl/⌘+Enter 提交
function bindEnterSubmit() {
  function handler(e) {
    if (e.isComposing) return;
    if (e.key !== "Enter") return;

    if (e.target === noteEl) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      submitBtn?.click();
      return;
    }
    e.preventDefault();
    submitBtn?.click();
  }
  whoEl?.addEventListener("keydown", handler);
  noteEl?.addEventListener("keydown", handler);
}

submitBtn?.addEventListener("click", async () => {
  const who = (whoEl?.value || "").trim();
  if (!who) return setMsg("请先填写“你是谁”。", false);

  const chosen = getChosenItems();
  if (chosen.length === 0) return setMsg("至少选一道菜再提交。", false);

  const note = (noteEl?.value || "").trim();

  setSubmitting(true);
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who, items: chosen, note }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMsg(data.error || "提交失败", false);
    // 提交成功后
    closeChosen(); // 关闭已选弹窗（如果开着）
    window.scrollTo({ top: 0, behavior: "smooth" });

    // ✅ 记录常点
    bumpFreq(chosen);

    qtyMap.clear();
    if (noteEl) noteEl.value = "";

    applyFilterAndRender();
    updateSummary();
    renderChosenList();

    setMsg(`提交成功 ✅ 订单号 #${data.id}`);
  } catch (e) {
    setMsg(`提交失败：${e?.message || "network error"}`, false);
  } finally {
    setSubmitting(false);
  }
});

/** ====== 常点统计 ====== */
function loadFreqMap() {
  try {
    const raw = localStorage.getItem(FREQ_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return (obj && typeof obj === "object") ? obj : {};
  } catch {
    return {};
  }
}
function saveFreqMap() {
  try { localStorage.setItem(FREQ_KEY, JSON.stringify(freqMap)); } catch {}
}
function getFreq(id) {
  return Math.max(0, parseInt(freqMap[String(id)] || 0, 10));
}
function bumpFreq(chosen) {
  for (const x of chosen) {
    const id = String(x.id);
    const add = Math.max(1, parseInt(x.qty || 1, 10));
    freqMap[id] = getFreq(id) + add;
  }
  saveFreqMap();
}

/** ====== Utils ====== */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}
function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(String(s));
  return String(s).replace(/"/g, '\\"');
}

/** ===== init ===== */
loadWho();
bindEnterSubmit();
loadMenu();
