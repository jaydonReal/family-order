# Family Order

一个家庭点菜小网站，包含：

- 点菜端：选择菜品并提交订单
- 厨房端：查看最新订单、切换状态、删除订单

## 本地运行

```bash
npm install
npm run dev
```

打开：

- 点菜端：`http://localhost:3000`
- 厨房端：`http://localhost:3000/admin.html`

## 环境变量

- `PORT`：部署平台分配的端口
- `ADMIN_KEY`：厨房端口令

## 免费部署建议

这个项目是 Node.js + Express 服务，不适合直接放到 GitHub Pages。

免费公开网址建议：

1. 代码托管到 GitHub
2. 部署到 Render 的免费 Web Service

注意：

- 当前订单数据默认保存在本地 `family.db`
- 免费云部署环境通常是临时磁盘，服务重启后订单数据可能丢失
- 如果你后面需要“数据长期保存”，可以再把数据库切到免费的 Supabase 或 Turso
