const state = {
  scanData: null,
  currentNode: null,
  currentPath: "",
  selectedNodePath: "",
  cleanupQueue: []
};

const STORAGE_KEY = "storage-inspector-last-scan";
const QUEUE_STORAGE_KEY = "storage-inspector-cleanup-queue";
const isMapPage = document.body.classList.contains("map-page");
const scanForm = document.querySelector("#scan-form");
const searchForm = document.querySelector("#search-form");
const pathInput = document.querySelector("#path-input");
const searchInput = document.querySelector("#search-input");
const statusText = document.querySelector("#status-text");
const treemap = document.querySelector("#treemap");
const metrics = document.querySelector("#metrics");
const systemStats = document.querySelector("#system-stats");
const searchResults = document.querySelector("#search-results");
const extensions = document.querySelector("#extensions");
const largestFiles = document.querySelector("#largest-files");
const breadcrumb = document.querySelector("#breadcrumb");
const listTemplate = document.querySelector("#list-item-template");
const openMapButton = document.querySelector("#open-map-button");
const mapScanButton = document.querySelector("#map-scan-button");
const inspector = document.querySelector("#inspector");
const inspectOpen = document.querySelector("#inspect-open");
const inspectQueue = document.querySelector("#inspect-queue");
const cleanupQueue = document.querySelector("#cleanup-queue");
const queueItems = document.querySelector("#queue-items");
const clearQueueButton = document.querySelector("#clear-queue");

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function setEmpty(container, message) {
  container.classList.add("empty");
  container.textContent = message;
}

function clearContainer(container) {
  container.classList.remove("empty");
  container.textContent = "";
}

function hashColor(seed) {
  let value = 0;
  for (const char of seed) {
    value = (value * 31 + char.charCodeAt(0)) % 360;
  }
  return `hsla(${value}, 68%, 44%, 0.88)`;
}

function layoutTreemap(items, x, y, width, height, vertical = width > height) {
  const total = items.reduce((sum, item) => sum + item.size, 0) || 1;
  let offset = 0;

  return items.map((item) => {
    const ratio = item.size / total;
    const rect = vertical
      ? { x: x + offset, y, width: width * ratio, height }
      : { x, y: y + offset, width, height: height * ratio };

    offset += vertical ? rect.width : rect.height;
    return { item, rect };
  });
}

function isVisibleRect(rect) {
  return rect.width > 28 && rect.height > 22;
}

function chooseFill(node, depth) {
  const palettes = [
    ["rgba(72, 106, 146, 0.82)", "rgba(56, 83, 122, 0.9)"],
    ["rgba(62, 116, 85, 0.82)", "rgba(49, 94, 69, 0.9)"],
    ["rgba(111, 95, 72, 0.82)", "rgba(95, 81, 61, 0.92)"],
    ["rgba(98, 85, 131, 0.84)", "rgba(75, 67, 104, 0.92)"]
  ];
  const index = Math.abs([...node.name].reduce((sum, char) => sum + char.charCodeAt(0), depth)) % palettes.length;
  const [a, b] = palettes[index];
  return `linear-gradient(180deg, ${a}, ${b})`;
}

function findNodeByPath(node, targetPath) {
  if (!node) {
    return null;
  }
  if (node.path === targetPath) {
    return node;
  }
  for (const child of node.children || []) {
    const found = findNodeByPath(child, targetPath);
    if (found) {
      return found;
    }
  }
  return null;
}

function renderMetrics() {
  if (!metrics) {
    return;
  }
  const inventory = state.scanData?.inventory;
  if (!inventory) {
    setEmpty(metrics, "No metrics yet.");
    return;
  }

  clearContainer(metrics);
  const grid = document.createElement("div");
  grid.className = "metric-grid";
  [
    ["Total size", formatBytes(inventory.totalSize)],
    ["Files", inventory.fileCount.toLocaleString()],
    ["Folders", inventory.scannedDirectories.toLocaleString()],
    ["Largest item", formatBytes(inventory.largestFiles[0]?.size || 0)]
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "metric";
    card.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    grid.appendChild(card);
  });
  metrics.appendChild(grid);
}

function renderSystemStats(payload) {
  if (!systemStats) {
    return;
  }
  clearContainer(systemStats);
  systemStats.innerHTML = `
    <p class="eyebrow">System</p>
    <div class="metric-grid">
      <div class="metric"><span>Platform</span><strong>${payload.platform}</strong></div>
      <div class="metric"><span>CPU Cores</span><strong>${payload.cpuCount}</strong></div>
      <div class="metric"><span>Memory Used</span><strong>${formatBytes(payload.memory.used)}</strong></div>
      <div class="metric"><span>Memory Free</span><strong>${formatBytes(payload.memory.free)}</strong></div>
    </div>
  `;
}

function renderBreadcrumb(node) {
  if (!breadcrumb) {
    return;
  }
  clearContainer(breadcrumb);
  const parts = node.path.split(/\\+/).filter(Boolean);
  const crumbs = [];
  let current = node.path.includes(":\\") ? `${node.path.slice(0, 2)}\\` : "";

  if (current) {
    crumbs.push({ label: current, path: current });
  }

  for (const part of parts.slice(current ? 1 : 0)) {
    current = current.endsWith("\\") ? `${current}${part}` : `${current}\\${part}`;
    crumbs.push({ label: part, path: current });
  }

  crumbs.forEach((crumb) => {
    const button = document.createElement("button");
    button.className = "crumb";
    button.textContent = crumb.label;
    button.onclick = () => {
      const nodeForPath = findNodeByPath(state.scanData.tree, crumb.path);
      if (nodeForPath) {
        state.currentNode = nodeForPath;
        renderTreemap(nodeForPath);
      }
    };
    breadcrumb.appendChild(button);
  });
}

function updateInspector(node) {
  if (!inspector) {
    return;
  }

  if (!node) {
    inspector.classList.add("empty");
    return;
  }

  inspector.classList.remove("empty");
  inspector.innerHTML = `
    <p class="eyebrow">Selection</p>
    <h4>${node.name}</h4>
    <p class="path">${node.path}</p>
    <p class="tile-meta">${node.type} • ${formatBytes(node.size)}</p>
    <div class="floating-actions">
      <button id="inspect-open" type="button" class="secondary" ${node.children?.length ? "" : "disabled"}>Zoom In</button>
      <button id="inspect-queue" type="button">Add To Queue</button>
    </div>
  `;

  const openButton = inspector.querySelector("#inspect-open");
  const queueButton = inspector.querySelector("#inspect-queue");

  openButton?.addEventListener("click", () => {
    if (node.children?.length) {
      renderTreemap(node);
    }
  });

  queueButton?.addEventListener("click", () => {
    const exists = state.cleanupQueue.some((item) => item.path === node.path);
    if (!exists) {
      state.cleanupQueue.push({
        name: node.name,
        path: node.path,
        size: node.size
      });
      persistQueue();
      renderCleanupQueue();
    }
  });
}

function persistQueue() {
  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(state.cleanupQueue));
}

function renderCleanupQueue() {
  if (!cleanupQueue || !queueItems || !clearQueueButton) {
    return;
  }

  const count = state.cleanupQueue.length;
  cleanupQueue.classList.toggle("empty", count === 0);
  cleanupQueue.querySelector("h4").textContent = `${count} item${count === 1 ? "" : "s"}`;
  clearQueueButton.disabled = count === 0;

  if (count === 0) {
    queueItems.textContent = "Nothing queued.";
    return;
  }

  queueItems.textContent = "";
  state.cleanupQueue.forEach((item) => {
    const row = document.createElement("article");
    row.className = "queue-item";
    row.innerHTML = `<strong>${item.name}</strong><p>${item.path}</p><p>${formatBytes(item.size)}</p>`;
    queueItems.appendChild(row);
  });
}

function createTile(node, rect, depth) {
  const tile = document.createElement("button");
  tile.className = `tile tile-depth-${Math.min(depth, 5)}`;
  if (node.path === state.selectedNodePath) {
    tile.classList.add("selected");
  }
  tile.style.left = `${rect.x}px`;
  tile.style.top = `${rect.y}px`;
  tile.style.width = `${rect.width}px`;
  tile.style.height = `${rect.height}px`;
  tile.style.background = chooseFill(node, depth);

  const showHeader = rect.height > 22 && rect.width > 60;
  const showMeta = rect.height > 58 && rect.width > 90;
  tile.innerHTML = `
    ${showHeader ? `<div class="tile-header">${node.name}</div>` : ""}
    <div class="tile-body">
      <span class="tile-chip"></span>
      ${showMeta ? `<h4>${node.children?.length ? node.children[0]?.name || node.name : node.name}</h4><p>${formatBytes(node.size)}</p><p class="tile-meta">${node.type}</p>` : ""}
    </div>
  `;

  tile.addEventListener("click", (event) => {
    event.stopPropagation();
    state.selectedNodePath = node.path;
    updateInspector(node);
    renderTreemap(state.currentNode);
  });

  tile.addEventListener("dblclick", (event) => {
    event.stopPropagation();
    if (node.children?.length) {
      renderTreemap(node);
    }
  });

  return tile;
}

function renderNestedTiles(container, node, x, y, width, height, depth = 0) {
  if (!node.children?.length) {
    return;
  }

  const headerHeight = height > 70 ? 20 : 0;
  const innerX = x + 2;
  const innerY = y + headerHeight + 2;
  const innerWidth = Math.max(width - 4, 0);
  const innerHeight = Math.max(height - headerHeight - 4, 0);
  const layout = layoutTreemap(node.children, innerX, innerY, innerWidth, innerHeight, width > height);

  layout.forEach(({ item, rect }) => {
    if (!isVisibleRect(rect)) {
      return;
    }

    const tile = createTile(item, rect, depth);
    container.appendChild(tile);

    if (item.children?.length && rect.width > 150 && rect.height > 90) {
      renderNestedTiles(container, item, rect.x, rect.y, rect.width, rect.height, depth + 1);
    }
  });
}

function renderTreemap(node) {
  if (!node || !node.children?.length) {
    setEmpty(treemap, "Nothing to visualize at this level.");
    return;
  }

  state.currentNode = node;
  clearContainer(treemap);
  renderBreadcrumb(node);
  treemap.addEventListener("click", () => {
    state.selectedNodePath = "";
    updateInspector(null);
    renderTreemap(state.currentNode);
  }, { once: true });

  renderNestedTiles(treemap, node, 0, 0, treemap.clientWidth || 1280, treemap.clientHeight || 720, 0);
  updateInspector(state.selectedNodePath ? findNodeByPath(state.scanData?.tree, state.selectedNodePath) : null);
}

function createFileCard(file, allowDelete = true) {
  const fragment = listTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".item");
  article.querySelector("h4").textContent = file.name;
  article.querySelector(".path").textContent = file.path;
  article.querySelector("strong").textContent = formatBytes(file.size);

  const button = article.querySelector("button");
  if (!allowDelete) {
    button.remove();
  } else {
    button.onclick = async () => {
      const ok = window.confirm(`Delete file?\n${file.path}`);
      if (!ok) {
        return;
      }

      const response = await fetch(`/api/file?path=${encodeURIComponent(file.path)}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Delete failed." }));
        window.alert(payload.error || "Delete failed.");
        return;
      }

      window.alert("File deleted.");
      runScan(state.currentPath);
    };
  }

  return fragment;
}

function renderLargestFiles(files) {
  if (!largestFiles) {
    return;
  }
  if (!files?.length) {
    setEmpty(largestFiles, "No files found.");
    return;
  }

  clearContainer(largestFiles);
  files.slice(0, 20).forEach((file) => largestFiles.appendChild(createFileCard(file)));
}

function renderSearchResults(files) {
  if (!searchResults) {
    return;
  }
  if (!files?.length) {
    setEmpty(searchResults, "No matching files.");
    return;
  }

  clearContainer(searchResults);
  files.forEach((file) => searchResults.appendChild(createFileCard(file)));
}

function renderExtensions(items) {
  if (!extensions) {
    return;
  }
  if (!items?.length) {
    setEmpty(extensions, "No extension data.");
    return;
  }

  clearContainer(extensions);
  items.slice(0, 12).forEach((item) => {
    const row = document.createElement("article");
    row.className = "item";
    row.innerHTML = `
      <div>
        <h4>${item.extension}</h4>
        <p class="path">Storage occupied by this file type</p>
      </div>
      <div class="item-actions">
        <strong>${formatBytes(item.size)}</strong>
      </div>
    `;
    extensions.appendChild(row);
  });
}

async function runScan(scanPath) {
  state.currentPath = scanPath;
  statusText.textContent = `Scanning ${scanPath}...`;

  const response = await fetch(`/api/scan?path=${encodeURIComponent(scanPath)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Scan failed.");
  }

  state.scanData = payload;
  state.currentNode = payload.tree;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

  statusText.textContent = `Scanned ${payload.inventory.fileCount.toLocaleString()} files on ${new Date(payload.scannedAt).toLocaleString()}.`;
  renderMetrics();
  renderTreemap(payload.tree);
  renderLargestFiles(payload.inventory.largestFiles);
  renderExtensions(payload.inventory.extensionBreakdown);
  if (openMapButton) {
    openMapButton.disabled = false;
  }
}

async function runSearch() {
  if (!state.currentPath) {
    window.alert("Run a scan first.");
    return;
  }

  const query = searchInput.value.trim();
  if (!query) {
    setEmpty(searchResults, "Enter a search term.");
    return;
  }

  const response = await fetch(`/api/search?path=${encodeURIComponent(state.currentPath)}&q=${encodeURIComponent(query)}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Search failed.");
  }

  renderSearchResults(payload.results);
}

async function loadSystemStats() {
  if (!systemStats) {
    return;
  }
  const response = await fetch("/api/stats");
  const payload = await response.json();
  renderSystemStats(payload);
}

function restoreLastScan() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return;
  }

  try {
    const payload = JSON.parse(raw);
    state.scanData = payload;
    state.currentNode = payload.tree;
    state.currentPath = payload.inventory?.rootPath || "";
    if (pathInput && state.currentPath) {
      pathInput.value = state.currentPath;
    }
    statusText.textContent = `Loaded previous scan for ${state.currentPath || "local storage"}.`;
    renderMetrics();
    renderTreemap(payload.tree);
    renderLargestFiles(payload.inventory?.largestFiles);
    renderExtensions(payload.inventory?.extensionBreakdown);
    if (openMapButton) {
      openMapButton.disabled = false;
    }
    updateInspector(null);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function restoreQueue() {
  const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
  if (!raw) {
    renderCleanupQueue();
    return;
  }

  try {
    state.cleanupQueue = JSON.parse(raw);
  } catch {
    state.cleanupQueue = [];
    localStorage.removeItem(QUEUE_STORAGE_KEY);
  }

  renderCleanupQueue();
}

if (scanForm) {
  scanForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await runScan(pathInput.value.trim());
    } catch (error) {
      statusText.textContent = error.message;
    }
  });
}

if (searchForm) {
  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await runSearch();
    } catch (error) {
      setEmpty(searchResults, error.message);
    }
  });
}

if (openMapButton) {
  openMapButton.addEventListener("click", () => {
    window.open("/map.html", "_blank", "noopener");
  });
}

if (mapScanButton) {
  mapScanButton.addEventListener("click", async () => {
    try {
      await runScan(pathInput.value.trim());
    } catch (error) {
      statusText.textContent = error.message;
    }
  });
}

if (clearQueueButton) {
  clearQueueButton.addEventListener("click", () => {
    state.cleanupQueue = [];
    persistQueue();
    renderCleanupQueue();
  });
}

window.addEventListener("resize", () => {
  if (state.currentNode) {
    renderTreemap(state.currentNode);
  }
});

restoreLastScan();
restoreQueue();

if (!isMapPage) {
  loadSystemStats();
  setInterval(loadSystemStats, 5000);
}
