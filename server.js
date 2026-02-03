const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { URL } = require("url");

const PORT = 3000;
const ROOT_DIR = __dirname;
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

async function ensureUploadDir() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
}

async function serveStatic(res, filePath) {
  try {
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME_TYPES[ext] || "application/octet-stream";
    send(res, 200, data, { "Content-Type": type });
  } catch (err) {
    if (err.code === "ENOENT") {
      send(res, 404, "Not Found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
  }
}

async function listImages() {
  await ensureUploadDir();
  const entries = await fsp.readdir(UPLOAD_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
    .map((entry) => entry.name);

  const stats = await Promise.all(
    files.map(async (name) => {
      const stat = await fsp.stat(path.join(UPLOAD_DIR, name));
      return { name, mtimeMs: stat.mtimeMs };
    })
  );

  return stats
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry) => ({
      filename: entry.name,
      url: `/uploads/${entry.name}`,
    }));
}

function safeUploadsPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const baseName = path.basename(decoded);
  return path.join(UPLOAD_DIR, baseName);
}

async function handleUpload(req, res) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY_SIZE) {
      send(res, 413, "Payload too large", { "Content-Type": "text/plain; charset=utf-8" });
      req.destroy();
    }
  });

  req.on("end", async () => {
    try {
      const { dataUrl } = JSON.parse(body || "{}");
      if (!dataUrl || typeof dataUrl !== "string") {
        send(res, 400, "Missing dataUrl", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }

      const match = dataUrl.match(/^data:image\/(png);base64,(.+)$/);
      if (!match) {
        send(res, 400, "Invalid image format", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }

      await ensureUploadDir();
      const buffer = Buffer.from(match[2], "base64");
      const filename = `paint-${Date.now()}.png`;
      const filepath = path.join(UPLOAD_DIR, filename);
      await fsp.writeFile(filepath, buffer);

      const payload = JSON.stringify({
        filename,
        url: `/uploads/${filename}`,
      });
      send(res, 200, payload, { "Content-Type": "application/json; charset=utf-8" });
    } catch (err) {
      send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
    }
  });
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function handleDelete(req, res, url) {
  let filename = url.searchParams.get("filename");
  if (!filename && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      filename = body.filename;
    } catch (err) {
      send(res, 400, "Invalid JSON body", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
  }

  if (!filename) {
    send(res, 400, "Missing filename", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const filePath = safeUploadsPath(filename);
  try {
    await fsp.unlink(filePath);
    send(res, 200, JSON.stringify({ filename }), {
      "Content-Type": "application/json; charset=utf-8",
    });
  } catch (err) {
    if (err.code === "ENOENT") {
      send(res, 404, "Not Found", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
    send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/list") {
    try {
      const items = await listImages();
      send(res, 200, JSON.stringify(items), { "Content-Type": "application/json; charset=utf-8" });
    } catch (err) {
      send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upload") {
    await handleUpload(req, res);
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/delete") {
    await handleDelete(req, res, url);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/delete") {
    await handleDelete(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
    const filePath = safeUploadsPath(url.pathname.replace("/uploads/", ""));
    await serveStatic(res, filePath);
    return;
  }

  if (req.method === "GET") {
    const route = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.join(ROOT_DIR, route);
    await serveStatic(res, filePath);
    return;
  }

  send(res, 405, "Method Not Allowed", { "Content-Type": "text/plain; charset=utf-8" });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
