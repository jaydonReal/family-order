# Family Order 微信小程序

这是 `family-order` 网站的微信小程序客户端。后端继续使用当前的 Render + Turso 服务。

## 使用步骤

1. 打开微信开发者工具
2. 导入本目录：`miniprogram`
3. 如果还没有小程序 AppID，可以先选择测试号或游客模式
4. 修改 `config.js` 里的 `apiBaseUrl`
5. 编译运行

## 重要配置

`config.js`：

```js
module.exports = {
  apiBaseUrl: "https://你的-render网址.onrender.com"
};
```

正式发布前，需要在微信公众平台后台把 Render 域名加入：

- 开发管理
- 开发设置
- 服务器域名
- request 合法域名

本地预览时，可以在微信开发者工具里临时勾选“不校验合法域名、web-view、TLS 版本以及 HTTPS 证书”。

## 页面

- 点菜页：`pages/order/order`
- 厨房页：`pages/admin/admin`

厨房页使用 Render 里的 `ADMIN_KEY` 作为口令。
