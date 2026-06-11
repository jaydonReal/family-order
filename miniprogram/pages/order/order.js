const { request } = require("../../utils/api");

Page({
  data: {
    menu: [],
    filteredMenu: [],
    tags: [],
    activeTag: "ALL",
    query: "",
    who: "",
    note: "",
    qtyMap: {},
    totalKinds: 0,
    totalQty: 0,
    summaryText: "还没有选择菜品",
    submitting: false
  },

  onLoad() {
    this.setData({ who: wx.getStorageSync("ORDER_WHO") || "" });
    this.loadMenu();
  },

  async loadMenu() {
    try {
      wx.showLoading({ title: "加载菜单" });
      const data = await request("/api/menu");
      const menu = Array.isArray(data.menu) ? data.menu : [];
      const tagSet = new Set();
      menu.forEach((item) => (item.tags || []).forEach((tag) => tagSet.add(String(tag))));
      this.setData({
        menu,
        tags: Array.from(tagSet).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
      });
      this.applyFilter();
    } catch (err) {
      wx.showToast({ title: err.message || "菜单加载失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  onWhoInput(event) {
    const who = event.detail.value;
    wx.setStorageSync("ORDER_WHO", who.trim());
    this.setData({ who });
  },

  onNoteInput(event) {
    this.setData({ note: event.detail.value });
  },

  onQueryInput(event) {
    this.setData({ query: event.detail.value }, () => this.applyFilter());
  },

  selectTag(event) {
    this.setData({ activeTag: event.currentTarget.dataset.tag || "ALL" }, () => this.applyFilter());
  },

  applyFilter() {
    const query = String(this.data.query || "").trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    const activeTag = this.data.activeTag;
    const filteredMenu = this.data.menu.filter((item) => {
      const name = String(item.name || "").toLowerCase();
      const okQuery = tokens.length === 0 || tokens.every((token) => name.includes(token));
      const okTag = activeTag === "ALL" || (item.tags || []).map(String).includes(activeTag);
      return okQuery && okTag;
    });
    this.setData({ filteredMenu });
  },

  changeQty(event) {
    const id = String(event.currentTarget.dataset.id || "");
    const delta = Number(event.currentTarget.dataset.delta || 0);
    const qtyMap = { ...this.data.qtyMap };
    const next = Math.max(0, Math.min(9, Number(qtyMap[id] || 0) + delta));
    if (next === 0) {
      delete qtyMap[id];
    } else {
      qtyMap[id] = next;
    }
    this.setData({ qtyMap }, () => this.updateSummary());
  },

  getChosenItems() {
    return this.data.menu
      .map((item) => {
        const id = String(item.id);
        const qty = Number(this.data.qtyMap[id] || 0);
        return qty > 0 ? { id: item.id, name: item.name, qty } : null;
      })
      .filter(Boolean);
  },

  updateSummary() {
    const chosen = this.getChosenItems();
    const totalQty = chosen.reduce((sum, item) => sum + item.qty, 0);
    const preview = chosen.slice(0, 3).map((item) => `${item.name}x${item.qty}`).join("、");
    this.setData({
      totalKinds: chosen.length,
      totalQty,
      summaryText: chosen.length ? (chosen.length > 3 ? `${preview} 等` : preview) : "还没有选择菜品"
    });
  },

  async submitOrder() {
    const who = String(this.data.who || "").trim();
    const chosen = this.getChosenItems();
    if (!who) {
      wx.showToast({ title: "请先填写点菜人", icon: "none" });
      return;
    }
    if (!chosen.length) {
      wx.showToast({ title: "至少选一道菜", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    try {
      const data = await request("/api/orders", {
        method: "POST",
        data: {
          who,
          items: chosen,
          note: String(this.data.note || "").trim()
        }
      });
      wx.showModal({
        title: "提交成功",
        content: `订单号 #${data.id}`,
        showCancel: false
      });
      this.setData({
        qtyMap: {},
        note: ""
      }, () => this.updateSummary());
    } catch (err) {
      wx.showToast({ title: err.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
