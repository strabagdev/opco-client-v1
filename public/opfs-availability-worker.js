/* Installed expo-sqlite 57.0.1 uses this flat OPFS pool. Never create or modify its files. */
self.onmessage = async ({ data }) => {
  if (data !== "check") return;
  const handles = [];
  let result = "unsupported";
  try {
    const root = await navigator.storage.getDirectory();
    const pool = await root.getDirectoryHandle("expo-sqlite", { create: false });
    const files = [];
    for await (const [name, file] of pool) {
      if (file.kind !== "file" || files.length >= 64) throw new Error("Unknown pool layout");
      files.push([name, file]);
    }
    if (!files.length) throw new Error("Missing existing pool");
    files.sort(([a], [b]) => a.localeCompare(b));
    for (const [, file] of files) handles.push(await file.createSyncAccessHandle());
    result = "free";
  } catch (error) {
    if (error?.name === "NoModificationAllowedError") result = "busy";
  } finally {
    for (const handle of handles) {
      try { handle.close(); } catch { result = "unsupported"; }
    }
  }
  // No paths, file contents, exception messages or user data cross this boundary.
  self.postMessage(result);
};
