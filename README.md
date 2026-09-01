# Storage Inspector

Storage Inspector is a local disk visualizer and cleanup dashboard inspired by DissectMac. It runs as a dependency-free Node app and keeps scanning data on your machine.

## Features

- Scan any local folder or drive by absolute path.
- Visualize large folders and files with an interactive treemap.
- Inspect the largest files for cleanup.
- Search within scanned results.
- See which file extensions are consuming the most space.
- View basic live system stats.
- Delete individual files from the UI.

## Run

```powershell
cd C:\Users\dhruv\Documents\GitHub\storage-inspector
node server.js
```

Then open `http://127.0.0.1:3030`.

## Notes

- This MVP scans locally and does not send data anywhere.
- Deletes are limited to files, not directories.
- Deep scans of very large drives can take time because this version avoids native dependencies.
