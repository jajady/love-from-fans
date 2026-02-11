const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { URL } = require("url");

const PORT = 3000;
const ROOT_DIR = __dirname;
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
const LAYOUT_FILE = path.join(UPLOAD_DIR, "layout.json");
const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

const STAGE_WIDTH = 4728;
const STAGE_HEIGHT = 5760;
const OVERLAY_LEFT = 1152;
const OVERLAY_WIDTH = 3576;
const OVERLAY_HEIGHT = 5760;
const PADDING_TOP = 100;
const PADDING_LEFT = 100;
const PADDING_RIGHT = 100;
const GAP = 50;
const COLUMNS = 6;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

function padNumber(value, length) {
  return String(value).padStart(length, "0");
}

function formatKstTimestamp(ms) {
  const kst = new Date(ms + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = padNumber(kst.getUTCMonth() + 1, 2);
  const day = padNumber(kst.getUTCDate(), 2);
  const hours = padNumber(kst.getUTCHours(), 2);
  const minutes = padNumber(kst.getUTCMinutes(), 2);
  const seconds = padNumber(kst.getUTCSeconds(), 2);
  const millis = padNumber(kst.getUTCMilliseconds(), 3);
  return `${year}${month}${day}_${hours}${minutes}${seconds}_${millis}`;
}

async function uniqueFilename(baseName) {
  const ext = path.extname(baseName);
  const base = baseName.slice(0, -ext.length);
  let candidate = baseName;
  let counter = 1;
  while (true) {
    try {
      await fsp.access(path.join(UPLOAD_DIR, candidate));
      candidate = `${base}-${counter}${ext}`;
      counter += 1;
    } catch (err) {
      if (err.code === "ENOENT") {
        return candidate;
      }
      throw err;
    }
  }
}

async function ensureUploadDir() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
}

async function getPngSize(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(24);
    await handle.read(buffer, 0, 24, 0);
    const isPng = buffer.readUInt32BE(0) === 0x89504e47;
    if (!isPng) {
      throw new Error("Not a PNG");
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height === 0) {
      throw new Error("Invalid PNG size");
    }
    return { width, height };
  } finally {
    await handle.close();
  }
}

async function readLayout() {
  try {
    const raw = await fsp.readFile(LAYOUT_FILE, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    if (parsed && Array.isArray(parsed.items)) {
      const items = parsed.items.filter((item) => item && typeof item.filename === "string");
      return { items, order: items.map((item) => item.filename) };
    }
    if (parsed && Array.isArray(parsed.order)) {
      return { items: [], order: parsed.order.filter((name) => typeof name === "string") };
    }
    return { items: [], order: [] };
  } catch (err) {
    if (err.code === "ENOENT") {
      return { items: [], order: [] };
    }
    throw err;
  }
}

async function writeLayout(items) {
  await ensureUploadDir();
  const payload = JSON.stringify({ items }, null, 2);
  await fsp.writeFile(LAYOUT_FILE, payload);
}

function roundLayoutValue(value) {
  return Math.round(value);
}

async function buildLayout() {
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

  const statMap = new Map(stats.map((entry) => [entry.name, entry.mtimeMs]));
  const layout = await readLayout();
  const existingSet = new Set(files);
  const savedOrder = layout.order.filter((name) => existingSet.has(name));
  const missing = stats
    .filter((entry) => !savedOrder.includes(entry.name))
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .map((entry) => entry.name);
  const order = savedOrder.concat(missing);

  if (order.length === 0) {
    return { items: [], order };
  }

  const cellWidth =
    (OVERLAY_WIDTH - PADDING_LEFT - PADDING_RIGHT - GAP * (COLUMNS - 1)) / COLUMNS;
  const leftOrigin = OVERLAY_LEFT + PADDING_LEFT;

  const baseItems = await Promise.all(
    order.map(async (name, index) => {
      const col = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      let height = cellWidth;
      try {
        const size = await getPngSize(path.join(UPLOAD_DIR, name));
        height = (cellWidth * size.height) / size.width;
      } catch (err) {
        // Fallback to square if size can't be read
      }
      return {
        filename: name,
        col,
        row,
        w: roundLayoutValue(cellWidth),
        h: roundLayoutValue(height),
        updatedAt: statMap.get(name) || Date.now(),
      };
    })
  );

  const rowHeights = new Map();
  baseItems.forEach((item) => {
    rowHeights.set(item.row, Math.max(rowHeights.get(item.row) || 0, item.h));
  });

  const rowCount = Math.max(...baseItems.map((item) => item.row)) + 1;
  const rowOffsets = new Map();
  let currentY = PADDING_TOP;
  for (let row = 0; row < rowCount; row += 1) {
    rowOffsets.set(row, currentY);
    currentY += (rowHeights.get(row) || 0) + GAP;
  }

  const items = baseItems.map((item) => ({
    ...item,
    x: roundLayoutValue(leftOrigin + item.col * (cellWidth + GAP)),
    y: roundLayoutValue(rowOffsets.get(item.row) || PADDING_TOP),
  }));

  return { items, order };
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
  const { items } = await buildLayout();
  await writeLayout(items);
  return items.map((item) => ({
    ...item,
    url: `/uploads/${item.filename}`,
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
      const timestamp = formatKstTimestamp(Date.now());
      const filename = await uniqueFilename(`paint-${timestamp}.png`);
      const filepath = path.join(UPLOAD_DIR, filename);
      await fsp.writeFile(filepath, buffer);
      const { items } = await buildLayout();
      await writeLayout(items);

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
    const { items } = await buildLayout();
    await writeLayout(items);
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
