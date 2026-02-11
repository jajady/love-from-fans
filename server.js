const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const { URL } = require("url");

const PORT = 3000;
const ROOT_DIR = __dirname;
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
const FOLDER_SIZE = 24;
const TRASH_DIR = path.join(UPLOAD_DIR, "trash");
const TRASH_MANIFEST = path.join(TRASH_DIR, "manifest.json");
const DEFAULT_IMAGE_WIDTH = 600;
const DEFAULT_IMAGE_HEIGHT = 400;
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

async function ensureTrashDir() {
  await fsp.mkdir(TRASH_DIR, { recursive: true });
}

async function readTrashManifest() {
  try {
    const raw = await fsp.readFile(TRASH_MANIFEST, "utf-8");
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function writeTrashManifest(entries) {
  await ensureTrashDir();
  const payload = JSON.stringify(entries, null, 2);
  await fsp.writeFile(TRASH_MANIFEST, payload);
}

function makeTrashId() {
  return `trash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isBatchDirName(name) {
  return /^batch-\d{4}$/.test(name);
}

async function countPngFiles(dirPath) {
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".png")).length;
}

async function getLatestBatchInfo() {
  await ensureUploadDir();
  const entries = await fsp.readdir(UPLOAD_DIR, { withFileTypes: true });
  const batches = entries
    .filter((entry) => entry.isDirectory() && isBatchDirName(entry.name))
    .map((entry) => entry.name);

  if (batches.length === 0) {
    return { name: null, index: 0 };
  }

  const indices = batches.map((name) => Number(name.replace("batch-", ""))).filter(Number.isFinite);
  const maxIndex = indices.length ? Math.max(...indices) : 0;
  const name = maxIndex > 0 ? `batch-${String(maxIndex).padStart(4, "0")}` : null;
  return { name, index: maxIndex };
}

async function getUploadTargetDir() {
  const { name, index } = await getLatestBatchInfo();
  if (!name) {
    const first = "batch-0001";
    const dirPath = path.join(UPLOAD_DIR, first);
    await fsp.mkdir(dirPath, { recursive: true });
    return { folder: first, dirPath };
  }

  const currentDir = path.join(UPLOAD_DIR, name);
  const count = await countPngFiles(currentDir);
  if (count < FOLDER_SIZE) {
    return { folder: name, dirPath: currentDir };
  }

  const nextIndex = index + 1;
  const nextName = `batch-${String(nextIndex).padStart(4, "0")}`;
  const nextDir = path.join(UPLOAD_DIR, nextName);
  await fsp.mkdir(nextDir, { recursive: true });
  return { folder: nextName, dirPath: nextDir };
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

async function moveToTrash(relPath) {
  await ensureTrashDir();
  const sourcePath = safeUploadsPath(relPath);
  if (sourcePath.startsWith(TRASH_DIR + path.sep)) {
    throw new Error("Already in trash");
  }

  const originalDir = path.dirname(relPath);
  const targetDir = path.join(TRASH_DIR, originalDir);
  await fsp.mkdir(targetDir, { recursive: true });

  const filename = path.basename(relPath);
  const targetName = await uniqueFilename(filename, targetDir);
  const targetPath = path.join(targetDir, targetName);
  await fsp.rename(sourcePath, targetPath);

  const trashedRelPath = path
    .relative(UPLOAD_DIR, targetPath)
    .split(path.sep)
    .join("/");

  const entry = {
    id: makeTrashId(),
    filename: targetName,
    originalPath: relPath,
    trashedPath: trashedRelPath,
    trashedAt: Date.now(),
  };

  const manifest = await readTrashManifest();
  manifest.unshift(entry);
  await writeTrashManifest(manifest);

  return entry;
}

async function restoreFromTrash(entry) {
  await ensureTrashDir();
  const sourcePath = safeUploadsPath(entry.trashedPath);
  if (!sourcePath.startsWith(TRASH_DIR + path.sep)) {
    throw new Error("Invalid trash path");
  }

  const originalRelPath = entry.originalPath || path.basename(entry.trashedPath);
  const targetPath = safeUploadsPath(originalRelPath);
  const targetDir = path.dirname(targetPath);
  await fsp.mkdir(targetDir, { recursive: true });

  let finalPath = targetPath;
  try {
    await fsp.access(finalPath);
    const uniqueName = await uniqueFilename(path.basename(targetPath), targetDir);
    finalPath = path.join(targetDir, uniqueName);
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
  }

  await fsp.rename(sourcePath, finalPath);

  return path
    .relative(UPLOAD_DIR, finalPath)
    .split(path.sep)
    .join("/");
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

function batchFolderName(index) {
  return `batch-${padNumber(index, 4)}`;
}

async function rebalanceBatches() {
  const { ordered } = await getOrderedImages();
  if (ordered.length === 0) {
    return;
  }

  for (let i = 0; i < ordered.length; i += 1) {
    const relPath = ordered[i];
    const filename = path.basename(relPath);
    const targetIndex = Math.floor(i / FOLDER_SIZE) + 1;
    const targetFolder = batchFolderName(targetIndex);
    const targetDir = path.join(UPLOAD_DIR, targetFolder);
    const targetRelPath = `${targetFolder}/${filename}`;

    if (relPath === targetRelPath) {
      continue;
    }

    await fsp.mkdir(targetDir, { recursive: true });

    const fromPath = path.join(UPLOAD_DIR, relPath);
    let targetName = filename;
    const targetPath = path.join(targetDir, targetName);
    try {
      await fsp.access(targetPath);
      targetName = await uniqueFilename(filename, targetDir);
    } catch (err) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }

    await fsp.rename(fromPath, path.join(targetDir, targetName));
  }

  const entries = await fsp.readdir(UPLOAD_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !isBatchDirName(entry.name)) {
      continue;
    }
    const dirPath = path.join(UPLOAD_DIR, entry.name);
    const remaining = await fsp.readdir(dirPath);
    if (remaining.length === 0) {
      await fsp.rmdir(dirPath);
    }
  }
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

async function listImages(folder) {
  if (folder) {
    try {
      await rebalanceBatches();
    } catch (err) {
      // ignore rebalance errors for listing
    }
    const folderPath = safeUploadsPath(folder);
    const entries = await fsp.readdir(folderPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".png"))
      .map((entry) => entry.name);

    const stats = await Promise.all(
      files.map(async (name) => {
        const stat = await fsp.stat(path.join(folderPath, name));
        return { name, mtimeMs: stat.mtimeMs };
      })
    );

    return stats
      .sort((a, b) => a.mtimeMs - b.mtimeMs)
      .map((entry) => {
        const relPath = `${folder}/${entry.name}`;
        return {
          filename: entry.name,
          path: relPath,
          url: `/uploads/${relPath}`,
        };
      });
  }

  const { ordered } = await getOrderedImages();
  return ordered.map((relPath) => ({
    filename: path.basename(relPath),
    path: relPath,
    url: `/uploads/${relPath}`,
  }));
}

async function listFolders() {
  await ensureUploadDir();
  const entries = await fsp.readdir(UPLOAD_DIR, { withFileTypes: true });
  const folders = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isBatchDirName(entry.name)) continue;
    const dirPath = path.join(UPLOAD_DIR, entry.name);
    const count = await countPngFiles(dirPath);
    folders.push({ folder: entry.name, count });
  }

  folders.sort((a, b) => a.folder.localeCompare(b.folder));
  return folders;
}

async function listTrash() {
  const manifest = await readTrashManifest();
  const items = [];

  for (const entry of manifest) {
    if (!entry || !entry.trashedPath) continue;
    try {
      const filePath = safeUploadsPath(entry.trashedPath);
      await fsp.access(filePath);
    } catch (err) {
      continue;
    }
    items.push({
      id: entry.id,
      filename: entry.filename || path.basename(entry.trashedPath),
      originalPath: entry.originalPath || "",
      trashedAt: entry.trashedAt || null,
      url: `/uploads/${entry.trashedPath}`,
    });
  }

  return items;
}

async function listSlots() {
  const slotDefs = await readSlotDefinitions();
  const { ordered, statMap } = await getOrderedImages();

  const activeSlots = slotDefs.filter(
    (slot) => !slot.disabled && Number.isFinite(slot.row) && Number.isFinite(slot.col)
  );
  if (activeSlots.length < SLOT_COUNT) {
    throw new Error(`slot.json must have at least ${SLOT_COUNT} enabled slots`);
  }

  const visibleSlots = activeSlots.slice(0, SLOT_COUNT);
  const visibleImages = ordered.slice(0, SLOT_COUNT);

  if (visibleImages.length === 0) {
    return [];
  }

  const cellWidth =
    (OVERLAY_WIDTH - PADDING_LEFT - PADDING_RIGHT - GAP * (COLUMNS - 1)) / COLUMNS;
  const cellHeight = (cellWidth * DEFAULT_IMAGE_HEIGHT) / DEFAULT_IMAGE_WIDTH;
  const leftOrigin = OVERLAY_LEFT + PADDING_LEFT;

  const count = Math.min(visibleSlots.length, visibleImages.length);
  const items = await Promise.all(
    visibleSlots.slice(0, count).map(async (slot, index) => {
      const relPath = visibleImages[index] || null;
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
      const { folder, dirPath } = await getUploadTargetDir();
      const filename = await uniqueFilename(`paint-${timestamp}.png`, dirPath);
      const filepath = path.join(dirPath, filename);
      await fsp.writeFile(filepath, buffer);

      const payload = JSON.stringify({
        filename,
        path: `${folder}/${filename}`,
        url: `/uploads/${folder}/${filename}`,
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
    const entry = await moveToTrash(target);
    try {
      await rebalanceBatches();
    } catch (err) {
      // ignore rebalance failures
    }
    send(res, 200, JSON.stringify({ path: entry.trashedPath }), {
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
      const folder = url.searchParams.get("folder");
      const items = await listImages(folder);
      send(res, 200, JSON.stringify(items), { "Content-Type": "application/json; charset=utf-8" });
    } catch (err) {
      send(res, 500, "Server Error", { "Content-Type": "text/plain; charset=utf-8" });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/folders") {
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

  if (req.method === "POST" && url.pathname === "/api/restore") {
    try {
      const body = await readJsonBody(req);
      const id = body.id;
      if (!id) {
        send(res, 400, "Missing id", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }
      const manifest = await readTrashManifest();
      const idx = manifest.findIndex((entry) => entry.id === id);
      if (idx === -1) {
        send(res, 404, "Not Found", { "Content-Type": "text/plain; charset=utf-8" });
        return;
      }
      const entry = manifest[idx];
      const restoredPath = await restoreFromTrash(entry);
      manifest.splice(idx, 1);
      await writeTrashManifest(manifest);
      try {
        await rebalanceBatches();
      } catch (err) {
        // ignore rebalance failures
      }
      send(res, 200, JSON.stringify({ path: restoredPath }), {
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

  if (req.method === "DELETE" && url.pathname === "/api/delete") {
    await handleDelete(req, res, url);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/delete") {
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
