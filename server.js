const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { URL } = require("url");

const PORT = 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");
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
const SLOT_COUNT = 24;
const SLOT_FILE = path.join(ROOT_DIR, "slot.json");
const TRASH_FILE = path.join(DATA_DIR, "trash.json");
const SELECTION_FILE = path.join(DATA_DIR, "selection.json");
const DEFAULT_IMAGE_WIDTH = 600;
const DEFAULT_IMAGE_HEIGHT = 400;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_COOKIE = "admin_session";

const sessions = new Map();

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

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function createSession() {
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, expiresAt);
  return { token, expiresAt };
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const expiresAt = sessions.get(token);
  if (!expiresAt) return null;
  if (Date.now() > expiresAt) {
    sessions.delete(token);
    return null;
  }
  return token;
}

function setSessionCookie(res, token, req) {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (req.headers["x-forwarded-proto"] === "https") {
    attrs.push("Secure");
  }
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(res, req) {
  const attrs = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (req.headers["x-forwarded-proto"] === "https") {
    attrs.push("Secure");
  }
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function requireAdmin(req, res) {
  const token = getSessionToken(req);
  if (!token) {
    send(res, 401, "Unauthorized", { "Content-Type": "text/plain; charset=utf-8" });
    return false;
  }
  return true;
}

async function handleLogin(req, res) {
  if (!ADMIN_PASSWORD) {
    send(res, 500, "Admin password not configured", {
      "Content-Type": "text/plain; charset=utf-8",
    });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    send(res, 400, "Invalid JSON body", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  const password = String(body?.password || "");
  const expected = String(ADMIN_PASSWORD);
  const matches =
    password.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(expected));
  if (!matches) {
    send(res, 401, "Unauthorized", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }
  const session = createSession();
  setSessionCookie(res, session.token, req);
  send(res, 200, JSON.stringify({ ok: true }), {
    "Content-Type": "application/json; charset=utf-8",
  });
}

async function handleLogout(req, res) {
  const token = getSessionToken(req);
  if (token) {
    sessions.delete(token);
  }
  clearSessionCookie(res, req);
  send(res, 200, JSON.stringify({ ok: true }), {
    "Content-Type": "application/json; charset=utf-8",
  });
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

async function uniqueFilename(baseName, dir = UPLOAD_DIR) {
  const ext = path.extname(baseName);
  const base = baseName.slice(0, -ext.length);
  let candidate = baseName;
  let counter = 1;
  while (true) {
    try {
      await fsp.access(path.join(dir, candidate));
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

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

async function readTrashList() {
  try {
    const raw = await fsp.readFile(TRASH_FILE, "utf-8");
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function writeTrashList(entries) {
  await ensureDataDir();
  const payload = JSON.stringify(entries, null, 2);
  await fsp.writeFile(TRASH_FILE, payload);
}

async function readSelection() {
  try {
    const raw = await fsp.readFile(SELECTION_FILE, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    const index = Number(parsed?.batchIndex);
    return Number.isFinite(index) ? index : null;
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function writeSelection(batchIndex) {
  await ensureDataDir();
  const payload = JSON.stringify({ batchIndex }, null, 2);
  await fsp.writeFile(SELECTION_FILE, payload);
}

function makeTrashId() {
  return `trash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRelPath(relPath) {
  return relPath.split(path.sep).join("/");
}

function isBatchDirName(name) {
  return /^batch-\d{4}$/.test(name);
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

async function markAsTrashed(relPath) {
  const sourcePath = safeUploadsPath(relPath);
  await fsp.access(sourcePath);

  const normalized = normalizeRelPath(path.relative(UPLOAD_DIR, sourcePath));
  const list = await readTrashList();
  const existing = list.find((entry) => entry.path === normalized);
  if (existing) {
    return existing;
  }

  const entry = {
    id: makeTrashId(),
    filename: path.basename(normalized),
    path: normalized,
    trashedAt: Date.now(),
  };

  list.unshift(entry);
  await writeTrashList(list);
  return entry;
}

async function restoreTrashEntry(id) {
  const list = await readTrashList();
  const idx = list.findIndex((entry) => entry.id === id);
  if (idx === -1) {
    return null;
  }
  const entry = list[idx];
  list.splice(idx, 1);
  await writeTrashList(list);
  return entry;
}

function roundLayoutValue(value) {
  return Math.round(value);
}

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

async function readSlotDefinitions() {
  try {
    const raw = await fsp.readFile(SLOT_FILE, "utf-8");
    const parsed = JSON.parse(raw || "[]");
    const slots = Array.isArray(parsed) ? parsed : parsed?.slots;
    if (!Array.isArray(slots)) {
      throw new Error("slot.json must be an array or { slots: [...] }");
    }
    if (slots.length < SLOT_COUNT) {
      throw new Error(`slot.json must contain at least ${SLOT_COUNT} slots`);
    }
    return slots
      .map((slot, index) => {
        const disabled = slot?.disabled === true || slot?.enabled === false;
        const row = Number(slot?.row);
        const col = Number(slot?.col);
        if (!disabled && (!Number.isFinite(row) || !Number.isFinite(col))) {
          throw new Error(`slot ${index + 1} missing row/col`);
        }
        return {
          slot: Number.isFinite(slot?.slot) ? Number(slot.slot) : index + 1,
          row: Number.isFinite(row) ? row : null,
          col: Number.isFinite(col) ? col : null,
          x: Number.isFinite(slot?.x) ? Number(slot.x) : null,
          y: Number.isFinite(slot?.y) ? Number(slot.y) : null,
          w: Number.isFinite(slot?.w) ? Number(slot.w) : null,
          h: Number.isFinite(slot?.h) ? Number(slot.h) : null,
          disabled,
        };
      })
      .sort((a, b) => a.slot - b.slot);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error("slot.json not found");
    }
    throw err;
  }
}

async function getOrderedImages() {
  await ensureUploadDir();
  const entries = await fsp.readdir(UPLOAD_DIR, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".png")) {
      files.push({ name: entry.name, path: entry.name });
    }
    if (entry.isDirectory() && isBatchDirName(entry.name)) {
      const dirPath = path.join(UPLOAD_DIR, entry.name);
      const inner = await fsp.readdir(dirPath, { withFileTypes: true });
      inner
        .filter((child) => child.isFile() && child.name.endsWith(".png"))
        .forEach((child) => {
          files.push({
            name: child.name,
            path: `${entry.name}/${child.name}`,
          });
        });
    }
  }

  const stats = await Promise.all(
    files.map(async (file) => {
      const stat = await fsp.stat(path.join(UPLOAD_DIR, file.path));
      return { ...file, mtimeMs: stat.mtimeMs };
    })
  );

  stats.sort((a, b) => a.mtimeMs - b.mtimeMs);
  const ordered = stats.map((entry) => entry.path);
  const statMap = new Map(stats.map((entry) => [entry.path, entry.mtimeMs]));

  return { ordered, statMap };
}

async function getTrashSet() {
  const list = await readTrashList();
  return new Set(list.map((entry) => entry.path));
}

function chunkArray(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function resolveBatchIndex(index, total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(index)) return 0;
  if (index < 0) return 0;
  if (index >= total) return total - 1;
  return index;
}

async function getSelectedBatchIndex(total) {
  const stored = await readSelection();
  return resolveBatchIndex(stored, total);
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
  const { ordered } = await getOrderedImages();
  const trashSet = await getTrashSet();
  return ordered
    .filter((relPath) => !trashSet.has(relPath))
    .map((relPath) => ({
      filename: path.basename(relPath),
      path: relPath,
      url: `/uploads/${relPath}`,
    }));
}

async function listFolders() {
  return [];
}

async function listTrash() {
  const list = await readTrashList();
  const items = [];

  for (const entry of list) {
    if (!entry || !entry.path) continue;
    try {
      const filePath = safeUploadsPath(entry.path);
      await fsp.access(filePath);
    } catch (err) {
      continue;
    }
    items.push({
      id: entry.id,
      filename: entry.filename || path.basename(entry.path),
      path: entry.path,
      trashedAt: entry.trashedAt || null,
      url: `/uploads/${entry.path}`,
    });
  }

  return items;
}

async function listBatches() {
  const items = await listImages();
  const batches = chunkArray(items, SLOT_COUNT).map((batchItems, index) => ({
    index,
    count: batchItems.length,
    items: batchItems,
  }));
  const selectedIndex = await getSelectedBatchIndex(batches.length);
  return {
    batchSize: SLOT_COUNT,
    selectedIndex,
    batches: batches.map((batch) => ({
      ...batch,
      isSelected: batch.index === selectedIndex,
    })),
  };
}

async function listSlots() {
  const slotDefs = await readSlotDefinitions();
  const { ordered, statMap } = await getOrderedImages();
  const trashSet = await getTrashSet();

  const activeSlots = slotDefs.filter(
    (slot) => !slot.disabled && Number.isFinite(slot.row) && Number.isFinite(slot.col)
  );
  if (activeSlots.length < SLOT_COUNT) {
    throw new Error(`slot.json must have at least ${SLOT_COUNT} enabled slots`);
  }

  const visibleSlots = activeSlots.slice(0, SLOT_COUNT);
  const visibleImages = ordered.filter((relPath) => !trashSet.has(relPath));
  const totalBatches = Math.ceil(visibleImages.length / SLOT_COUNT);
  const selectedIndex = await getSelectedBatchIndex(totalBatches);
  if (selectedIndex === null) {
    return [];
  }
  const start = selectedIndex * SLOT_COUNT;
  const batchImages = visibleImages.slice(start, start + SLOT_COUNT);

  if (batchImages.length === 0) {
    return [];
  }

  const cellWidth =
    (OVERLAY_WIDTH - PADDING_LEFT - PADDING_RIGHT - GAP * (COLUMNS - 1)) / COLUMNS;
  const cellHeight = (cellWidth * DEFAULT_IMAGE_HEIGHT) / DEFAULT_IMAGE_WIDTH;
  const leftOrigin = OVERLAY_LEFT + PADDING_LEFT;

  const count = Math.min(visibleSlots.length, batchImages.length);
  const items = await Promise.all(
    visibleSlots.slice(0, count).map(async (slot, index) => {
      const relPath = batchImages[index] || null;
      if (!relPath) {
        return null;
      }
      const filename = path.basename(relPath);
      const width = isFiniteNumber(slot.w) ? slot.w : cellWidth;
      let height = isFiniteNumber(slot.h) ? slot.h : cellHeight;
      try {
        const size = await getPngSize(path.join(UPLOAD_DIR, relPath));
        height = (width * size.height) / size.width;
      } catch (err) {
        // fallback to default aspect ratio
      }

      const x = isFiniteNumber(slot.x)
        ? slot.x
        : leftOrigin + slot.col * (cellWidth + GAP);
      const y = isFiniteNumber(slot.y)
        ? slot.y
        : PADDING_TOP + slot.row * (cellHeight + GAP);

      return {
        filename,
        row: slot.row,
        col: slot.col,
        x: roundLayoutValue(x),
        y: roundLayoutValue(y),
        w: roundLayoutValue(width),
        h: roundLayoutValue(height),
        updatedAt: statMap.get(relPath) || Date.now(),
        url: `/uploads/${relPath}`,
      };
    })
  );

  return items.filter(Boolean);
}

function safeUploadsPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  if (path.isAbsolute(normalized)) {
    throw new Error("Invalid path");
  }
  const resolved = path.resolve(UPLOAD_DIR, normalized);
  if (resolved !== UPLOAD_DIR && !resolved.startsWith(UPLOAD_DIR + path.sep)) {
    throw new Error("Invalid path");
  }
  return resolved;
}

function safePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const relative = normalized.replace(/^[/\\]+/, "");
  const resolved = path.resolve(PUBLIC_DIR, relative);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    throw new Error("Invalid path");
  }
  return resolved;
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

      const buffer = Buffer.from(match[2], "base64");
      const timestamp = formatKstTimestamp(Date.now());
      const filename = await uniqueFilename(`paint-${timestamp}.png`, UPLOAD_DIR);
      const filepath = path.join(UPLOAD_DIR, filename);
      await fsp.writeFile(filepath, buffer);

      const payload = JSON.stringify({
        filename,
        path: filename,
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
  let target = url.searchParams.get("path") || url.searchParams.get("filename");
  if (!target && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      target = body.path || body.filename;
    } catch (err) {
      send(res, 400, "Invalid JSON body", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }
  }

  if (!target) {
    send(res, 400, "Missing path", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  try {
    const entry = await markAsTrashed(target);
    send(res, 200, JSON.stringify({ path: entry.path }), {
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
    if (!requireAdmin(req, res)) return;
    try {
      const items = await listImages();
      send(res, 200, JSON.stringify(items), { "Content-Type": "application/json; charset=utf-8" });
    } catch (err) {
      send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/folders") {
    if (!requireAdmin(req, res)) return;
    try {
      const folders = await listFolders();
      send(res, 200, JSON.stringify(folders), {
        "Content-Type": "application/json; charset=utf-8",
      });
    } catch (err) {
      send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/trash") {
    if (!requireAdmin(req, res)) return;
    try {
      const items = await listTrash();
      send(res, 200, JSON.stringify(items), {
        "Content-Type": "application/json; charset=utf-8",
      });
    } catch (err) {
      send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/batches") {
    if (!requireAdmin(req, res)) return;
    try {
      const payload = await listBatches();
      send(res, 200, JSON.stringify(payload), {
        "Content-Type": "application/json; charset=utf-8",
      });
    } catch (err) {
      send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/batches/select") {
    if (!requireAdmin(req, res)) return;
    try {
      const body = await readJsonBody(req);
      const index = Number(body?.index);
      if (!Number.isFinite(index) || index < 0) {
        send(res, 400, "Invalid index", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }
      await writeSelection(Math.floor(index));
      send(res, 200, JSON.stringify({ ok: true }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    } catch (err) {
      send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/restore") {
    if (!requireAdmin(req, res)) return;
    try {
      const body = await readJsonBody(req);
      const id = body.id;
      if (!id) {
        send(res, 400, "Missing id", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }
      const entry = await restoreTrashEntry(id);
      if (!entry) {
        send(res, 404, "Not Found", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }
      send(res, 200, JSON.stringify({ path: entry.path }), {
        "Content-Type": "application/json; charset=utf-8",
      });
    } catch (err) {
      send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/slots") {
    try {
      const items = await listSlots();
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

  if (req.method === "POST" && url.pathname === "/api/login") {
    await handleLogin(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    await handleLogout(req, res);
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/delete") {
    if (!requireAdmin(req, res)) return;
    await handleDelete(req, res, url);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/delete") {
    if (!requireAdmin(req, res)) return;
    await handleDelete(req, res, url);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
    try {
      const filePath = safeUploadsPath(url.pathname.replace("/uploads/", ""));
      await serveStatic(res, filePath);
    } catch (err) {
      send(res, 400, "Invalid path", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return;
  }

  if (req.method === "GET") {
    try {
      const route = url.pathname === "/" ? "index.html" : url.pathname;
      const filePath = safePublicPath(route);
      await serveStatic(res, filePath);
    } catch (err) {
      send(res, 400, "Invalid path", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return;
  }

  send(res, 405, "Method Not Allowed", { "Content-Type": "text/plain; charset=utf-8" });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
