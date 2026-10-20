// 本地模拟 Supabase：PostgREST 子集 + Storage 子集 + 静态托管，用来验证前端的云端代码路径。
// 只实现爪记用到的那几个端点，故意保持最简。
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const nodePath = require("path");

const PORT = Number(process.env.MOCK_PORT || 8788);
const ANON = process.env.MOCK_ANON || "test-anon-key";
const ROOT = nodePath.resolve(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};

const rows = [];
const objects = new Map();
let nextId = 1;

// 预置一条「别的用户」的动态，用来验证跨用户可见
rows.push({
  id: nextId++,
  created_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
  user: "橘子妈妈",
  avatar: "🐱",
  pet: "橘猫 · 2 岁",
  city: "上海 · 徐汇",
  body: "云端已经通了，这条是别人发的动态，你在任何设备上都能看到。",
  images: [],
  likes: 3,
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range",
};

function send(res, code, body, type) {
  const payload =
    body === null || body === undefined
      ? ""
      : typeof body === "string" || Buffer.isBuffer(body)
      ? body
      : JSON.stringify(body);
  res.writeHead(code, { ...cors, "Content-Type": type || "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = nodePath.resolve(ROOT, rel);
  if (!rel || !file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  send(res, 200, fs.readFileSync(file), MIME[nodePath.extname(file)] || "application/octet-stream");
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    return res.end();
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks);

    // ---- 静态文件（同源，方便浏览器直接跑 QA 页面）----
    if (req.method === "GET" && !pathname.startsWith("/rest/") && !pathname.startsWith("/storage/")) {
      if (serveStatic(req, res, pathname)) return;
      return send(res, 404, { message: "no file" });
    }

    // ---- Storage：公开读不需要 key（与 Supabase public bucket 一致）----
    const pubMatch = pathname.match(/^\/storage\/v1\/object\/public\/pawlog\/(.+)$/);
    if (pubMatch && req.method === "GET") {
      const name = decodeURIComponent(pubMatch[1]);
      const obj = objects.get(name);
      if (!obj) return send(res, 404, { message: "not found" });
      return send(res, 200, obj.data, obj.type);
    }

    const auth = req.headers["apikey"] || (req.headers.authorization || "").replace("Bearer ", "");
    if (auth !== ANON) return send(res, 401, { message: "bad key" });

    // ---- PostgREST ----
    if (pathname === "/rest/v1/pawlog_posts") {
      if (req.method === "GET") {
        const sorted = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return send(res, 200, sorted);
      }
      if (req.method === "POST") {
        let body;
        try { body = JSON.parse(raw.toString("utf8")); } catch (e) { return send(res, 400, { message: "bad json" }); }
        if (!body || !body.body || !String(body.body).trim()) return send(res, 400, { message: "body required" });
        const row = {
          id: nextId++,
          created_at: new Date().toISOString(),
          user: body.user || "匿名",
          avatar: body.avatar || "🐾",
          pet: body.pet || "",
          city: body.city || "",
          body: String(body.body),
          images: Array.isArray(body.images) ? body.images : [],
          likes: 0,
        };
        rows.push(row);
        return send(res, 201, row);
      }
    }

    // ---- Storage ----
    const upMatch = pathname.match(/^\/storage\/v1\/object\/pawlog\/(.+)$/);
    if (upMatch && req.method === "POST") {
      const name = decodeURIComponent(upMatch[1]);
      objects.set(name, { data: raw, type: req.headers["content-type"] || "image/jpeg" });
      return send(res, 200, { Key: `pawlog/${name}`, Id: crypto.randomUUID() });
    }
    send(res, 404, { message: "no route " + req.method + " " + pathname });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock supabase + static on http://127.0.0.1:${PORT} (anon=${ANON}, seeded=${rows.length})`);
});
