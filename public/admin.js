const keyEl = document.getElementById("key");
const statusEl = document.getElementById("status");
const latestEl = document.getElementById("latest");
const listEl = document.getElementById("list");

let latestId = null;
let autoTimer = null;
let autoOn = true;
let es = null;
let sseRetry = 0;
let sseTimer = null;



// ====== New order alert settings ======
const ALERT_ENABLED_KEY = "ALERT_ENABLED";
const LAST_NOTIFIED_ID_KEY = "LAST_NOTIFIED_ORDER_ID";

let audioCtx = null;

function isAlertEnabled() {
  return localStorage.getItem(ALERT_ENABLED_KEY) === "true";
}

function setAlertEnabled(v) {
  localStorage.setItem(ALERT_ENABLED_KEY, v ? "true" : "false");
}

function getLastNotifiedId() {
  const v = localStorage.getItem(LAST_NOTIFIED_ID_KEY);
  const n = parseInt(v || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

function setLastNotifiedId(id) {
  localStorage.setItem(LAST_NOTIFIED_ID_KEY, String(id));
}

function ensureAudioUnlocked() {
  // Must be triggered by a user gesture (click)
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
}

function chime() {
    if (!audioCtx) return;
  
    const now = audioCtx.currentTime;
  
    function playTone(freq, start, duration) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
  
      o.type = "sine";
      o.frequency.setValueAtTime(freq, start);
  
      // 柔和包络：快速起音，缓慢衰减
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  
      o.connect(g);
      g.connect(audioCtx.destination);
  
      o.start(start);
      o.stop(start + duration);
    }
  
    // 两个音：低→高（更像“叮咚”）
    playTone(660, now, 0.18);        // E5
    playTone(990, now + 0.14, 0.22); // B5
  }
  

async function maybeNotifyNewOrder(order) {
  if (!order) return;

  // Only notify when enabled
  if (!isAlertEnabled()) return;

  // Only for NEW orders (you也可以删掉这行，让DONE也提示)
  if (order.status !== "NEW") return;

  const last = getLastNotifiedId();
  if (order.id <= last) return; // already notified

  // Save first to avoid duplicates if multiple refreshes happen fast
  setLastNotifiedId(order.id);

  // Sound
  ensureAudioUnlocked();
  chime();

  // Visual hint on page
  setStatus(`🔔 新订单来了：#${order.id}（${order.who}）`, true);

  // Desktop notification (optional)
  if ("Notification" in window) {
    if (Notification.permission === "granted") {
      const itemText = (order.items || []).map(x => {
        if (typeof x === "string") return x;
        const name = x?.name || "";
        const qty = Math.max(1, parseInt(x?.qty || 1, 10));
        return `${name}×${qty}`;
      }).join("、");
      
      new Notification("🍽️ 新订单来了", {
        body: `#${order.id} · ${order.who}：${itemText}${order.note ? "（备注：" + order.note + "）" : ""}`
      });      
    }
  }
}

function connectSSE(){
  const key = getKey();
  if (!key) return;

  clearTimeout(sseTimer); // ✅ 防止旧重连timer叠加
  sseTimer = null;

  // 先关旧连接
  try { es?.close(); } catch {}
  es = null;

  const url = `/api/stream?key=${encodeURIComponent(key)}`;
  es = new EventSource(url);

  es.onopen = () => {
    sseRetry = 0;
    setStatus("✅ 实时连接已建立", true);
    stopAuto(); // ✅ SSE 成功后停轮询
  };

  es.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data || "{}");
      // 收到任何变更事件，刷新列表/最新
      if (
        msg.type === "order_created" ||
        msg.type === "order_updated" ||
        msg.type === "order_deleted" ||
        msg.type === "orders_cleared"
      ){
        refreshAll(); // 先用全量刷新，稳；后面再做局部更新
      }
    } catch {}
  };

  es.onerror = () => {
    try { es?.close(); } catch {}
    es = null;

    startAuto(); // ✅ 断线期间用轮询兜底
    // 指数退避重连：1s/2s/4s/8s...最多 10s
    const wait = Math.min(10000, 1000 * Math.pow(2, sseRetry++));
    setStatus(`⚠️ 实时连接断开，${Math.round(wait/1000)}s 后重连...`, false);
    clearTimeout(sseTimer);
    sseTimer = setTimeout(connectSSE, wait);
  };
}


function setStatus(text, ok=true){
  statusEl.textContent = text;
  statusEl.style.color = ok ? "#16a34a" : "#dc2626";
}

function getKey(){
  return localStorage.getItem("ADMIN_KEY") || "";
}

function saveKey(){
  localStorage.setItem("ADMIN_KEY", keyEl.value.trim());
  setStatus("已保存口令。");
  connectSSE();   // ✅ 保存后用新 key 立刻建立 SSE
  refreshAll();
}

document.getElementById("save").addEventListener("click", saveKey);
document.getElementById("refresh").addEventListener("click", () => refreshAll());
document.getElementById("toggleAuto").addEventListener("click", () => {
  if (autoOn) stopAuto();
  else startAuto();
});


document.getElementById("cooking").addEventListener("click", async () => {
  const key = getKey();
  if (!key) return setStatus("请先保存口令。", false);
  if (!latestId) return setStatus("没有可操作的订单。", false);

  const res = await fetch(`/api/orders/${latestId}/cooking?key=${encodeURIComponent(key)}`, {
    method: "POST"
  });
  const data = await res.json();
  if (!res.ok) return setStatus(data.error || "操作失败", false);

  setStatus("已开始制作 👨‍🍳", true);
  refreshAll();
});

async function adminPost(path) {
  const key = getKey();
  if (!key) throw new Error("请先保存口令。");
  const res = await fetch(`${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`, { method: "POST" });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  if (!res.ok) throw new Error(data.error || `操作失败：HTTP ${res.status}`);
  return data;
}


async function adminDelete(path) {
  const key = getKey();
  if (!key) throw new Error("请先保存口令。");
  const res = await fetch(`${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`, { method: "DELETE" });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  if (!res.ok) throw new Error(data.error || `删除失败：HTTP ${res.status}`);
  return data;
}



const alertHintEl = document.getElementById("alertHint");

document.getElementById("enableAlert").addEventListener("click", async () => {
  // need key saved too, but not strictly required
  ensureAudioUnlocked();
  setAlertEnabled(true);

  if ("Notification" in window) {
    try {
      const p = await Notification.requestPermission();
      if (p === "granted") {
        alertHintEl.textContent = "提醒已启用：声音 ✅ 通知 ✅";
      } else {
        alertHintEl.textContent = "提醒已启用：声音 ✅ 通知未授权（不影响叮声）";
      }
    } catch {
      alertHintEl.textContent = "提醒已启用：声音 ✅（通知可能不可用）";
    }
  } else {
    alertHintEl.textContent = "提醒已启用：声音 ✅（浏览器不支持通知）";
  }

  // immediate test 
  chime();
  setStatus("提醒已启用 ✅", true);
});

document.getElementById("testAlert").addEventListener("click", () => {
  ensureAudioUnlocked();
  chime();
  setStatus("已测试铃声 ✅", true);
});

document.getElementById("filterStatus").addEventListener("change", () => {
  updateFilterButtons();
  refreshAll();
});


document.getElementById("filterAll")?.addEventListener("click", () => setFilter("ALL"));
document.getElementById("filterNew")?.addEventListener("click", () => setFilter("NEW"));
document.getElementById("filterCooking")?.addEventListener("click", () => setFilter("COOKING"));
document.getElementById("toggleDone")?.addEventListener("click", toggleDone);



document.getElementById("reloadMenu").addEventListener("click", async () => {
    const key = getKey();
    if (!key) return setStatus("请先保存口令。", false);
  
    const res = await fetch(`/api/admin/menu/reload?key=${encodeURIComponent(key)}`, {
      method: "POST"
    });
    const data = await res.json();
    if (!res.ok) return setStatus(data.error || "Reload 失败", false);
  
    setStatus(`菜单已 Reload ✅ 当前 ${data.count} 道菜`);
  });
  

document.getElementById("done").addEventListener("click", async () => {
  const key = getKey();
  if (!key) return setStatus("请先保存口令。", false);
  if (!latestId) return setStatus("没有可完成的订单。", false);

  const res = await fetch(`/api/orders/${latestId}/done?key=${encodeURIComponent(key)}`, { method:"POST" });
  const data = await res.json();
  if (!res.ok) return setStatus(data.error || "操作失败", false);

  setStatus("已标记完成 ✅");
  refreshAll();
});

async function fetchLatest() {
  try{
    const key = getKey();
  if (!key) {
    setStatus("请先输入并保存口令。", false);
    return;
  }

  const res = await fetch(`/api/orders/latest?key=${encodeURIComponent(key)}`);
  const data = await res.json();
  if (!res.ok) return setStatus(data.error || "获取失败", false);

  const o = data.order;
  if (!o) {
    latestId = null;
    latestEl.textContent = "暂无订单";
    return;
  }
  latestId = o.id;

  const time = new Date(o.created_at).toLocaleString();

  const dishBadges = renderDishBadges(o.items);


  latestEl.innerHTML = `
    <div><b>#${o.id}</b> <span class="${
      o.status === "DONE" ? "status-done" :
      o.status === "COOKING" ? "status-cooking" :
      "status-new"
    }">${o.status}</span></div>
    <div>时间：${time}</div>
    <div>点菜人：<b>${escapeHtml(o.who)}</b></div>
    <div>菜品：${dishBadges || "（无）"}</div>
    <div>备注：${escapeHtml(o.note || "（无）")}</div>
  `;

  await maybeNotifyNewOrder(o)}
  catch (e) {
    latestEl.textContent = "加载失败";
    setStatus(`最新订单加载异常：${e.message}`, false);
  }
}



async function fetchList() {
  try {
    const key = getKey();
    const res = await fetch(`/api/orders?limit=20&key=${encodeURIComponent(key)}`);

    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch { data = { _raw: text }; }

    if (!res.ok) {
      document.getElementById("colNew").textContent = "加载失败";
      document.getElementById("colCooking").textContent = "加载失败";
      document.getElementById("colDone").textContent = "加载失败";
      return setStatus(data.error || `获取订单失败：HTTP ${res.status}`, false);
    }

    const orders = data.orders || [];
    const filter = document.getElementById("filterStatus")?.value || "ALL";
    const filtered = filter === "ALL" ? orders : orders.filter(o => o.status === filter);


    const listNew = filtered.filter(o => o.status === "NEW");
    const listCooking = filtered.filter(o => o.status === "COOKING");
    const listDone = filtered.filter(o => o.status === "DONE");

    document.getElementById("cntNew").textContent = `(${listNew.length})`;
    document.getElementById("cntCooking").textContent = `(${listCooking.length})`;
    document.getElementById("cntDone").textContent = `(${listDone.length})`;

    function renderColumn(arr) {
      if (!arr.length) return `<div class="muted">暂无</div>`;

      return arr.map((o) => {
        const time = new Date(o.created_at).toLocaleString();
      
        const statusClass =
          o.status === "DONE" ? "status-done" :
          o.status === "COOKING" ? "status-cooking" :
          "status-new";
      
        const dishBadges = renderDishBadges(o.items);
      
        const noteText = (o.note || "").trim();
        const noteHtml = noteText
          ? `<div class="note">备注：${escapeHtml(noteText)}</div>`
          : `<div class="note muted">备注：（无）</div>`;
      
        // ✅ 关键：在模板外算好
        const canCooking = o.status === "NEW";
        const canDone = o.status === "NEW" || o.status === "COOKING";
      
        return `
          <div class="item">
            <div class="order-meta">
              <div class="idline">
                <span class="oid">#${o.id}</span>
                <span class="statusTag ${statusClass}">${o.status}</span>
              </div>
              <div class="sub">${time}</div>
              <div class="sub">点菜人：<b>${escapeHtml(o.who)}</b></div>
            </div>
      
            <div class="order-body">
              <div class="badges">${dishBadges || "<span class='muted'>（无菜品）</span>"}</div>
              ${noteHtml}
            </div>
      
            <div class="actions">
              <button class="ghost" data-act="cooking" data-id="${o.id}" ${canCooking ? "" : "disabled"}>开始做</button>
              <button class="ghost" data-act="done" data-id="${o.id}" ${canDone ? "" : "disabled"}>完成</button>
              <button class="ghost" data-act="delete" data-id="${o.id}">删除</button>
            </div>
          </div>
        `;
      }).join("");      
    }

    document.getElementById("colNew").innerHTML = renderColumn(listNew);
    document.getElementById("colCooking").innerHTML = renderColumn(listCooking);
    document.getElementById("colDone").innerHTML = renderColumn(listDone);

  } catch (e) {
    document.getElementById("colNew").textContent = "加载失败";
    document.getElementById("colCooking").textContent = "加载失败";
    document.getElementById("colDone").textContent = "加载失败";
    setStatus(`列表加载异常：${e.message}`, false);
  }
}




document.getElementById("clearDone").addEventListener("click", async () => {
  try {
    if (!confirm("确认删除所有 DONE 订单吗？不可恢复。")) return;
    const data = await adminDelete("/api/orders?status=DONE");
    setStatus(`已清空 DONE ✅ 共删除 ${data.deleted || 0} 条`, true);
    refreshAll();
  } catch (err) {
    setStatus(err.message || "清理失败", false);
  }
});

document.getElementById("deleteLatest").addEventListener("click", async () => {
  try {
    if (!latestId) return setStatus("没有可删除的订单。", false);
    if (!confirm(`确认删除订单 #${latestId} 吗？不可恢复。`)) return;
    await adminDelete(`/api/orders/${latestId}`);
    setStatus(`订单 #${latestId} 已删除 🗑️`, true);
    refreshAll();
  } catch (err) {
    setStatus(err.message || "删除失败", false);
  }
});


listEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  if (btn.disabled) return;

  const act = btn.getAttribute("data-act");
  const id = btn.getAttribute("data-id");

  try {
    if (act === "cooking") {
      await adminPost(`/api/orders/${id}/cooking`);
      setStatus(`订单 #${id} 已开始制作 👨‍🍳`, true);
    } else if (act === "done") {
      await adminPost(`/api/orders/${id}/done`);
      setStatus(`订单 #${id} 已标记完成 ✅`, true);
    } else if (act === "delete") {
      if (!confirm(`确认删除订单 #${id} 吗？此操作不可恢复。`)) return;
      const data = await adminDelete(`/api/orders/${id}`);
      setStatus(`订单 #${id} 已删除 🗑️（${data.deleted || 0}）`, true);
    }
    refreshAll();
  } catch (err) {
    setStatus(err.message || "操作失败", false);
  }
});

function renderDishBadges(items){
  return (items || []).map((x) => {
    if (typeof x === "string") return `<span class="badge">${escapeHtml(x)}</span>`;
    const name = escapeHtml(x.name || "");
    const qty = Math.max(1, parseInt(x.qty || 1, 10));
    if (!name) return "";
    return `<span class="badge">${name} ×${qty}</span>`;
  }).filter(Boolean).join(" ");
}


function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}

async function refreshAll(){
  await fetchLatest();
  await fetchList();
}

function startAuto(){
  stopAuto();
  autoOn = true;
  autoTimer = setInterval(refreshAll, 3000);
  updateAutoUI();
}
function stopAuto(){
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
  autoOn = false;
  updateAutoUI();
}

function updateAutoUI(){
  const btn = document.getElementById("toggleAuto");
  const state = document.getElementById("autoState");
  if (!btn || !state) return;

  if (autoOn) {
    btn.textContent = "暂停自动刷新";
    state.textContent = "自动刷新：开启";
  } else {
    btn.textContent = "恢复自动刷新";
    state.textContent = "自动刷新：暂停";
  }
}




const DONE_COLLAPSED_KEY = "DONE_COLLAPSED";

function setFilter(v){
  const sel = document.getElementById("filterStatus");
  if (sel) sel.value = v;
  refreshAll();
  updateFilterButtons();
}

function updateFilterButtons(){
  const sel = document.getElementById("filterStatus");
  const v = sel ? sel.value : "ALL";

  document.getElementById("filterAll")?.classList.toggle("active", v === "ALL");
  document.getElementById("filterNew")?.classList.toggle("active", v === "NEW");
  document.getElementById("filterCooking")?.classList.toggle("active", v === "COOKING");
}

function isDoneCollapsed(){
  return localStorage.getItem(DONE_COLLAPSED_KEY) === "true";
}

function applyDoneCollapsed(){
  const board = document.getElementById("list"); // 直接用 list 当 board
  const btn = document.getElementById("toggleDone");
  if (!board || !btn) return;

  const collapsed = isDoneCollapsed();
  board.classList.toggle("done-collapsed", collapsed);
  btn.textContent = collapsed ? "显示 DONE" : "隐藏 DONE";
}

function toggleDone(){
  localStorage.setItem(DONE_COLLAPSED_KEY, (!isDoneCollapsed()) ? "true" : "false");
  applyDoneCollapsed();
}

function init(){
  keyEl.value = getKey();
  applyDoneCollapsed();
  updateFilterButtons();
  refreshAll();
  startAuto();

  connectSSE(); // ✅ 页面打开就连
}
init();



