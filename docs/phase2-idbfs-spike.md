# Phase 2 IDBFS Spike

Validated against the pinned browser runtime `v314.0.5` on 2026-08-25.

- `pyodide.FS.mount`, `pyodide.FS.filesystems.IDBFS`, and `pyodide.FS.syncfs` are available in the worker runtime.
- `FS.syncfs(true, callback)` populates the mounted in-memory tree from IndexedDB; `FS.syncfs(false, callback)` persists the current tree. The pinned build exposes the callback API, so application code must wrap it in a promise.
- `sysconfig.get_paths()["purelib"]` reports `//lib/python3.14/site-packages`; the normalized Emscripten path is `/lib/python3.14/site-packages`.
- Mounting IDBFS directly over the empty site-packages directory works, and a Python module written there can be imported after the mount.
- IDBFS uses the mountpoint as the IndexedDB database name. A direct site-packages mount therefore cannot be version-keyed by itself.
- A version-keyed sibling mount created before interpreter startup, populated with `syncfs(true)`, and exposed through a site-packages symlink successfully imports Python modules. Phase 2 should use this `fsInit` placement, with an ephemeral site-packages fallback if mount, sync, or validation fails.
