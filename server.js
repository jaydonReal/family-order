import express from "express";
import { createClient } from "@libsql/client";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "url";
import fs from "fs";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);
const DB_FILE_PATH = path.join(__dirname, "family.db");
const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

// ====== 你可以改这里：菜单 + 管理端口令 ======
const ADMIN_KEY = process.env.ADMIN_KEY || "123456"; // 厨房端查看/操作口令（建议改复杂点）
const MENU_PATH = path.join(__dirname, "menu.json");

function loadMenuFromFile() {
  const raw = fs.readFileSync(MENU_PATH, "utf-8");
  const menu = JSON.parse(raw);
  if (!Array.isArray(menu)) throw new Error("menu.json must be an array");
  return menu;
}

function parseOrderRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    items: JSON.parse(row.items_json || "[]")
  };
}

function createSqliteRepo(dbFilePath) {
  const db = new sqlite3.Database(dbFilePath);

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) return reject(err);
        resolve({ changes: this.changes, lastID: this.lastID });
      });
    });

  const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row || null);
      });
    });

  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });

  return {
    engine: "sqlite",
    async init() {
      await run(`
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          who TEXT NOT NULL,
          items_json TEXT NOT NULL,
          note TEXT,
          status TEXT NOT NULL DEFAULT 'NEW'
        )
      `);
    },
    async createOrder(createdAt, who, itemsJson, note) {
      const result = await run(
        `INSERT INTO orders (created_at, who, items_json, note, status) VALUES (?, ?, ?, ?, 'NEW')`,
        [createdAt, who, itemsJson, note]
      );
      return result.lastID;
    },
    async getLatestOrder() {
      return get(`SELECT * FROM orders ORDER BY id DESC LIMIT 1`);
    },
    async listOrders(limit) {
      return all(`SELECT * FROM orders ORDER BY id DESC LIMIT ?`, [limit]);
    },
    async updateOrderStatus(id, status) {
      const result = await run(`UPDATE orders SET status=? WHERE id=?`, [status, id]);
      return result.changes;
    },
    async deleteOrder(id) {
      const result = await run(`DELETE FROM orders WHERE id=?`, [id]);
      return result.changes;
    },
    async deleteDoneOrders() {
      const result = await run(`DELETE FROM orders WHERE status='DONE'`);
      return result.changes;
    }
  };
}

function createTursoRepo(databaseUrl, authToken) {
  const client = createClient({
    url: databaseUrl,
    authToken: authToken || undefined
  });

  const execute = async (sql, args = []) => {
    const result = await client.execute({ sql, args });
    return result;
  };

  return {
    engine: "turso",
    async init() {
      await execute(`
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          who TEXT NOT NULL,
          items_json TEXT NOT NULL,
          note TEXT,
          status TEXT NOT NULL DEFAULT 'NEW'
        )
      `);
    },
    async createOrder(createdAt, who, itemsJson, note) {
      const result = await execute(
        `INSERT INTO orders (created_at, who, items_json, note, status)
         VALUES (?, ?, ?, ?, 'NEW')
         RETURNING id`,
        [createdAt, who, itemsJson, note]
      );
      return Number(result.rows?.[0]?.id || 0);
    },
    async getLatestOrder() {
      const result = await execute(`SELECT * FROM orders ORDER BY id DESC LIMIT 1`);
      return result.rows?.[0] || null;
    },
    async listOrders(limit) {
      const result = await execute(`SELECT * FROM orders ORDER BY id DESC LIMIT ?`, [limit]);
      return result.rows || [];
    },
    async updateOrderStatus(id, status) {
      const result = await execute(`UPDATE orders SET status=? WHERE id=?`, [status, id]);
      return Number(result.rowsAffected || 0);
    },
    async deleteOrder(id) {
      const result = await execute(`DELETE FROM orders WHERE id=?`, [id]);
      return Number(result.rowsAffected || 0);
    },
    async deleteDoneOrders() {
      const result = await execute(`DELETE FROM orders WHERE status='DONE'`);
      return Number(result.rowsAffected || 0);
    }
  };
}

function createRepo() {
  if (TURSO_DATABASE_URL) {
    return createTursoRepo(TURSO_DATABASE_URL, TURSO_AUTH_TOKEN);
  }
  return createSqliteRepo(DB_FILE_PATH);
}

const repo = createRepo();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ====== API ======
app.get("/api/menu", (req, res) => {
  try {
    const stat = fs.statSync(MENU_PATH);
    const raw = fs.readFileSync(MENU_PATH, "utf-8");
    const menu = JSON.parse(raw);
    if (!Array.isArray(menu)) throw new Error("menu.json must be an array");

    res.json({
      menu,
      __debug: {
        menuPath: MENU_PATH,
        mtime: stat.mtime.toISOString(),
        size: stat.size,
        count: menu.length,
        cwd: process.cwd()
      }
    });
  } catch (err) {
    res.status(500).json({ error: "读取 menu.json 失败", detail: String(err?.message || err) });
  }
});

app.post("/api/admin/menu/reload", requireAdmin, (req, res) => {
  try {
    const stat = fs.statSync(MENU_PATH);
    const menu = loadMenuFromFile();

    res.json({
      ok: true,
      count: menu.length,
      mtime: stat.mtime.toISOString(),
      menuPath: MENU_PATH
    });
  } catch (err) {
    res.status(500).json({ error: "reload menu failed", detail: String(err?.message || err) });
  }
});
  

app.post("/api/orders", async (req, res) => {
  const { who, items, note } = req.body || {};
  if (!who || typeof who !== "string") return res.status(400).json({ error: "who required" });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items required" });
  }
  
  // normalize items: allow ["番茄炒蛋"] or [{id,name,qty}]
  const normalized = items
    .map((it) => {
      if (typeof it === "string") return { name: it, qty: 1 };
      if (it && typeof it === "object") {
        const name = String(it.name || "").trim();
        const qty = Math.max(1, parseInt(it.qty || 1, 10));
        if (!name) return null;
        return { id: it.id ? String(it.id) : undefined, name, qty };
      }
      return null;
    })
    .filter(Boolean);
  
  if (normalized.length === 0) {
    return res.status(400).json({ error: "items required" });
  }
  
  const createdAt = new Date().toISOString();
  const itemsJson = JSON.stringify(normalized);
  try {
    const id = await repo.createOrder(createdAt, who.trim(), itemsJson, (note || "").trim());
    sseSend({ type: "order_created", id });
    res.json({ ok: true, id });
  } catch {
    res.status(500).json({ error: "db insert failed" });
  }
});

function requireAdmin(req, res, next) {
  const key = req.headers["x-admin-key"] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ====== SSE: realtime updates ======
const sseClients = new Set();

function sseSend(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch {}
  }
}

app.get("/api/stream", requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // ✅ 防代理缓冲
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: "hello", t: Date.now() })}\n\n`);
  sseClients.add(res);

  // ✅ 心跳，防止闲置被断开
  const ping = setInterval(() => {
    try { res.write(`: ping ${Date.now()}\n\n`); } catch {}
  }, 25000);

  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});


  

app.get("/api/orders/latest", requireAdmin, async (req, res) => {
  try {
    const row = await repo.getLatestOrder();
    if (!row) return res.json({ order: null });
    res.json({ order: parseOrderRow(row) });
  } catch {
    res.status(500).json({ error: "db query failed" });
  }
});

app.get("/api/orders", requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
  try {
    const rows = await repo.listOrders(limit);
    res.json({ orders: rows.map(parseOrderRow) });
  } catch {
    res.status(500).json({ error: "db query failed" });
  }
});

app.post("/api/orders/:id/done", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const changed = await repo.updateOrderStatus(id, "DONE");
    sseSend({ type: "order_updated", id, status: "DONE" });
    res.json({ ok: true, changed });
  } catch {
    res.status(500).json({ error: "db update failed" });
  }
});

app.post("/api/orders/:id/cooking", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const changed = await repo.updateOrderStatus(id, "COOKING");
    sseSend({ type: "order_updated", id, status: "COOKING" });
    res.json({ ok: true, changed });
  } catch {
    res.status(500).json({ error: "db update failed" });
  }
});



// 删除单条订单
app.delete("/api/orders/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const deleted = await repo.deleteOrder(id);
    sseSend({ type: "order_deleted", id });
    res.json({ ok: true, deleted });
  } catch {
    res.status(500).json({ error: "db delete failed" });
  }
});

app.delete("/api/orders", requireAdmin, async (req, res) => {
  const status = String(req.query.status || "");
  if (status !== "DONE") return res.status(400).json({ error: "only support status=DONE" });

  try {
    const deleted = await repo.deleteDoneOrders();
    sseSend({ type: "orders_cleared", status: "DONE", deleted });
    res.json({ ok: true, deleted });
  } catch {
    res.status(500).json({ error: "db delete failed" });
  }
});

await repo.init();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Family Order running: http://localhost:${PORT}`);
  console.log(`On LAN: http://<你的电脑IP>:${PORT}`);
  console.log(`DB engine: ${repo.engine}`);
});
