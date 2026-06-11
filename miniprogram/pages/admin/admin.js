const { request } = require("../../utils/api");

Page({
  data: {
    adminKey: "",
    orders: [],
    visibleOrders: [],
    filter: "ALL"
  },

  onLoad() {
    this.setData({ adminKey: wx.getStorageSync("ADMIN_KEY") || "" });
    if (this.data.adminKey) this.loadOrders();
  },

  onShow() {
    if (this.data.adminKey) this.loadOrders();
  },

  onKeyInput(event) {
    this.setData({ adminKey: event.detail.value });
  },

  saveKey() {
    wx.setStorageSync("ADMIN_KEY", String(this.data.adminKey || "").trim());
    wx.showToast({ title: "已保存", icon: "success" });
    this.loadOrders();
  },

  setFilter(event) {
    this.setData({ filter: event.currentTarget.dataset.filter || "ALL" }, () => this.applyFilter());
  },

  async loadOrders() {
    const key = String(this.data.adminKey || "").trim();
    if (!key) {
      wx.showToast({ title: "请先填写口令", icon: "none" });
      return;
    }
    try {
      wx.showLoading({ title: "加载订单" });
      const data = await request(`/api/orders?limit=50&key=${encodeURIComponent(key)}`);
      const orders = (data.orders || []).map((order) => ({
        ...order,
        displayTime: new Date(order.created_at).toLocaleString()
      }));
      this.setData({ orders }, () => this.applyFilter());
    } catch (err) {
      wx.showToast({ title: err.message || "订单加载失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  applyFilter() {
    const filter = this.data.filter;
    const visibleOrders = filter === "ALL"
      ? this.data.orders
      : this.data.orders.filter((order) => order.status === filter);
    this.setData({ visibleOrders });
  },

  async updateStatus(event) {
    const id = event.currentTarget.dataset.id;
    const action = event.currentTarget.dataset.action;
    const key = String(this.data.adminKey || "").trim();
    try {
      await request(`/api/orders/${id}/${action}?key=${encodeURIComponent(key)}`, { method: "POST" });
      wx.showToast({ title: "已更新", icon: "success" });
      this.loadOrders();
    } catch (err) {
      wx.showToast({ title: err.message || "操作失败", icon: "none" });
    }
  },

  deleteOrder(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除订单",
      content: `确认删除订单 #${id} 吗？`,
      success: async (res) => {
        if (!res.confirm) return;
        const key = String(this.data.adminKey || "").trim();
        try {
          await request(`/api/orders/${id}?key=${encodeURIComponent(key)}`, { method: "DELETE" });
          wx.showToast({ title: "已删除", icon: "success" });
          this.loadOrders();
        } catch (err) {
          wx.showToast({ title: err.message || "删除失败", icon: "none" });
        }
      }
    });
  }
});
