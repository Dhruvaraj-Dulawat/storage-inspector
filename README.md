# Storage Inspector

Storage Inspector is a local disk visualizer and cleanup dashboard inspired by DissectMac. It runs as a dependency-free Node app, scans local folders by absolute path, and renders a dense fullscreen treemap with a motherboard-style visual system.

Repository: `https://github.com/Dhruvaraj-Dulawat/storage-inspector`

## Current Features

- Scan any local folder or drive by absolute path.
- Open the treemap in a dedicated fullscreen tab.
- Navigate nested storage blocks with click, double-click, and breadcrumbs.
- Search scanned files by name or path.
- Review the largest files and dominant extensions.
- Queue cleanup candidates from the fullscreen map.
- Delete individual files from the UI.
- View live local system stats.

## Run Locally

```powershell
cd C:\Users\dhruv\Documents\GitHub\storage-inspector
node server.js
```

Open `http://127.0.0.1:3030`.

## Fullscreen Map Controls

- `Click` selects a block and opens the inspector.
- `Double-click` zooms into a folder-like block.
- `Right-click` opens the context menu for zoom, queue, or file deletion.
- `Open Fullscreen Map` launches the map in a new tab and restores the last scan.

## Project Structure

```text
storage-inspector/
  public/
    app.js
    index.html
    map.html
    styles.css
  server.js
  package.json
```

## Technical Notes

- The app is fully local and sends no scan data to external services.
- Delete actions are limited to files.
- Large drives can take time to scan because this version intentionally avoids native indexing dependencies.
- Scan state and cleanup queue are persisted in `localStorage` for the browser session.
