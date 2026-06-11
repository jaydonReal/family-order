const { apiBaseUrl } = require("../config");

function request(path, options = {}) {
  const url = `${apiBaseUrl}${path}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: options.method || "GET",
      data: options.data || undefined,
      header: {
        "content-type": "application/json",
        ...(options.header || {})
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
          return;
        }
        reject(new Error(res.data?.error || `请求失败：${res.statusCode}`));
      },
      fail(err) {
        reject(new Error(err.errMsg || "网络请求失败"));
      }
    });
  });
}

module.exports = { request, apiBaseUrl };
