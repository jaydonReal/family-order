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
- `TURSO_DATABASE_URL`：线上 Turso 数据库地址
- `TURSO_AUTH_TOKEN`：Turso 访问令牌

## 免费部署建议

这个项目是 Node.js + Express 服务，不适合直接放到 GitHub Pages。

免费公开网址建议：

1. 代码托管到 GitHub
2. 部署到 Render 的免费 Web Service
3. 数据库存到 Turso 免费版

注意：

- 本地开发默认还是使用 `family.db`
- 只要配置了 `TURSO_DATABASE_URL` 和 `TURSO_AUTH_TOKEN`，服务就会自动切到 Turso
- 免费云部署环境本地磁盘通常不持久，所以线上建议一定要配 Turso

## 推荐部署结构

- GitHub：放代码
- Render：放网站
- Turso：存订单数据

## Turso 配好后的线上环境变量

- `ADMIN_KEY`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
