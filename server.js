const http = require("http");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { URL } = require("url");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || 3030;
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_CHILDREN = 250;
const MAX_DEPTH = 6;
const TOP_RESULTS_LIMIT = 250;
const SEARCH_RESULTS_LIMIT = 150;
const SKIP_DIRS = new Set([
  "$recycle.bin",
  "system volume information",
  "windows",
  "programdata"
]);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(message);
}

function normalizeRequestedPath(inputPath) {
  if (!inputPath) {
    return null;
  }

  const resolved = path.resolve(inputPath);
  const root = path.parse(resolved).root;

  if (!resolved.startsWith(root)) {
    return null;
  }

  return resolved;
}

function isSkippedDirectory(dirName) {
  return SKIP_DIRS.has(dirName.toLowerCase());
}

function classifyByExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) {
    return "No extension";
  }
  return ext;
}

async function safeLstat(targetPath) {
  try {
    return await fsp.lstat(targetPath);
  } catch {
    return null;
  }
}

async function buildTree(targetPath, depth = 0, seen = new Set()) {
  const stats = await safeLstat(targetPath);
  if (!stats) {
    return null;
  }

  const realPath = stats.isSymbolicLink() ? targetPath : await fsp.realpath(targetPath).catch(() => targetPath);
  if (seen.has(realPath)) {
    return null;
  }
  seen.add(realPath);

  const node = {
    name: path.basename(targetPath) || targetPath,
    path: targetPath,
    size: stats.size || 0,
    type: stats.isDirectory() ? "directory" : "file",
    children: [],
    modifiedAt: stats.mtime.toISOString()
  };

  if (!stats.isDirectory() || depth >= MAX_DEPTH) {
    return node;
  }

  let entries;
  try {
    entries = await fsp.readdir(targetPath, { withFileTypes: true });
  } catch {
    node.error = "Access denied";
    return node;
  }

  const childNodes = [];
  for (const entry of entries) {
    if (entry.isDirectory() && isSkippedDirectory(entry.name)) {
      continue;
    }

    const childPath = path.join(targetPath, entry.name);
    const childNode = await buildTree(childPath, depth + 1, seen);
    if (childNode) {
      childNodes.push(childNode);
    }
  }

  childNodes.sort((a, b) => b.size - a.size);
  node.children = childNodes.slice(0, MAX_CHILDREN);
  node.size = node.children.reduce((sum, child) => sum + child.size, 0);

  if (childNodes.length > MAX_CHILDREN) {
    const hiddenSize = childNodes.slice(MAX_CHILDREN).reduce((sum, child) => sum + child.size, 0);
    node.children.push({
      name: `+${childNodes.length - MAX_CHILDREN} more`,
      path: targetPath,
      size: hiddenSize,
      type: "aggregate",
      children: []
    });
    node.size += hiddenSize;
  }

  return node;
}

async function collectFileInventory(targetPath) {
  const rootPath = normalizeRequestedPath(targetPath);
  if (!rootPath) {
    throw new Error("Invalid path.");
  }

  const queue = [rootPath];
  const files = [];
  const extensionTotals = new Map();
  let scannedDirectories = 0;

  while (queue.length > 0) {
    const currentPath = queue.shift();
    const stats = await safeLstat(currentPath);
    if (!stats) {
      continue;
    }

    if (stats.isDirectory()) {
      scannedDirectories += 1;
      let entries;
      try {
        entries = await fsp.readdir(currentPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory() && isSkippedDirectory(entry.name)) {
          continue;
        }
        queue.push(path.join(currentPath, entry.name));
      }
      continue;
    }

    const extension = classifyByExtension(currentPath);
    const fileInfo = {
      name: path.basename(currentPath),
      path: currentPath,
      size: stats.size,
      extension,
      modifiedAt: stats.mtime.toISOString()
    };

    files.push(fileInfo);
    extensionTotals.set(extension, (extensionTotals.get(extension) || 0) + stats.size);
  }

  files.sort((a, b) => b.size - a.size);

  const largestFiles = files.slice(0, TOP_RESULTS_LIMIT);
  const extensionBreakdown = [...extensionTotals.entries()]
    .map(([extension, size]) => ({ extension, size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 24);

  return {
    rootPath,
    scannedDirectories,
    fileCount: files.length,
    totalSize: files.reduce((sum, file) => sum + file.size, 0),
    files,
    largestFiles,
    extensionBreakdown
  };
}

async function handleScan(reqUrl, res) {
  const requestedPath = normalizeRequestedPath(reqUrl.searchParams.get("path"));
  if (!requestedPath) {
    sendJson(res, 400, { error: "A valid absolute path is required." });
    return;
  }

  const rootStats = await safeLstat(requestedPath);
  if (!rootStats) {
    sendJson(res, 404, { error: "Path not found." });
    return;
  }

  const [tree, inventory] = await Promise.all([
    buildTree(requestedPath),
    collectFileInventory(requestedPath)
  ]);

  sendJson(res, 200, {
    scannedAt: new Date().toISOString(),
    tree,
    inventory
  });
}

async function handleSearch(reqUrl, res) {
  const requestedPath = normalizeRequestedPath(reqUrl.searchParams.get("path"));
  const query = (reqUrl.searchParams.get("q") || "").trim().toLowerCase();

  if (!requestedPath || !query) {
    sendJson(res, 400, { error: "Both path and q are required." });
    return;
  }

  const inventory = await collectFileInventory(requestedPath);
  const results = inventory.files
    .filter((file) => file.name.toLowerCase().includes(query) || file.path.toLowerCase().includes(query))
    .sort((a, b) => b.size - a.size)
    .slice(0, SEARCH_RESULTS_LIMIT);

  sendJson(res, 200, {
    query,
    rootPath: requestedPath,
    results
  });
}

async function handleDelete(reqUrl, res) {
  const requestedPath = normalizeRequestedPath(reqUrl.searchParams.get("path"));
  if (!requestedPath) {
    sendJson(res, 400, { error: "A valid path is required." });
    return;
  }

  const stats = await safeLstat(requestedPath);
  if (!stats || stats.isDirectory()) {
    sendJson(res, 400, { error: "Only existing files can be deleted from this MVP." });
    return;
  }

  await fsp.unlink(requestedPath);
  sendJson(res, 200, { deleted: requestedPath });
}

function snapshotSystemStats() {
  const memoryTotal = os.totalmem();
  const memoryFree = os.freemem();
  const load = os.loadavg();

  return {
    capturedAt: new Date().toISOString(),
    platform: `${os.platform()} ${os.release()}`,
    uptimeSeconds: os.uptime(),
    cpuCount: os.cpus().length,
    loadAverage: load,
    memory: {
      total: memoryTotal,
      free: memoryFree,
      used: memoryTotal - memoryFree
    }
  };
}

async function serveStatic(reqPath, res) {
  const filePath = reqPath === "/"
    ? path.join(PUBLIC_DIR, "index.html")
    : path.join(PUBLIC_DIR, reqPath.replace(/^\/+/, ""));

  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const content = await fsp.readFile(normalized);
    const ext = path.extname(normalized).toLowerCase();
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream"
    });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && reqUrl.pathname === "/api/scan") {
      await handleScan(reqUrl, res);
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/api/search") {
      await handleSearch(reqUrl, res);
      return;
    }

    if (req.method === "GET" && reqUrl.pathname === "/api/stats") {
      sendJson(res, 200, snapshotSystemStats());
      return;
    }

    if (req.method === "DELETE" && reqUrl.pathname === "/api/file") {
      await handleDelete(reqUrl, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(reqUrl.pathname, res);
      return;
    }

    sendText(res, 405, "Method not allowed");
  } catch (error) {
    sendJson(res, 500, {
      error: error && error.message ? error.message : "Unexpected server error."
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Storage Inspector running at http://${HOST}:${PORT}`);
});
