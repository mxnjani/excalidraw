/**
 * fileOps.ts — Centralised save / open operations for the Excalidraw desktop app.
 *
 * Wraps the Tauri FS polyfills (window.showSaveFilePicker / showOpenFilePicker)
 * that are installed in main.tsx, tracking the "active" file handle so we can
 * do in-place saves without showing a dialog every time.
 */

import { serializeAsJSON } from "@excalidraw/excalidraw";

// The currently open file handle, or null if no file is associated.
let _activeHandle: FileSystemFileHandle | null = null;

export function hasActiveFile(): boolean {
  return _activeHandle !== null;
}

export function clearActiveFile(): void {
  _activeHandle = null;
}

/**
 * Save — smart save:
 *   - If a file is already open, write to it in place (no dialog).
 *   - If no file is open, open a Save As dialog.
 * Returns the filename that was saved, or null if the user cancelled.
 */
export async function saveFile(excalidrawAPI: any): Promise<string | null> {
  try {
    if (_activeHandle) {
      return await _writeToHandle(_activeHandle, excalidrawAPI);
    }
    return await saveFileAs(excalidrawAPI);
  } catch (err: any) {
    if (err?.name === "AbortError") return null;
    throw err;
  }
}

/**
 * Save As — always shows the file picker dialog, then saves.
 * Returns the filename that was saved, or null if the user cancelled.
 */
export async function saveFileAs(excalidrawAPI: any): Promise<string | null> {
  try {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: "drawing.excalidraw",
      types: [
        {
          description: "Excalidraw",
          accept: { "application/json": [".excalidraw"] },
        },
      ],
    });
    _activeHandle = handle;
    return await _writeToHandle(handle, excalidrawAPI);
  } catch (err: any) {
    if (err?.name === "AbortError") return null;
    throw err;
  }
}

/**
 * Open — shows the file picker and loads the selected file into Excalidraw.
 * Returns the filename that was opened, or null if the user cancelled.
 */
export async function openFile(excalidrawAPI: any): Promise<string | null> {
  try {
    const [handle] = await (window as any).showOpenFilePicker({ multiple: false });
    const file: File = await handle.getFile();
    const text = await file.text();
    const data = JSON.parse(text);
    await excalidrawAPI.updateScene({
      elements: data.elements ?? [],
      appState: { ...(data.appState ?? {}), theme: excalidrawAPI.getAppState().theme },
      files: data.files ?? {},
    });
    _activeHandle = handle;
    // Dispatch the same event the FS polyfill uses so App.tsx tracking stays in sync
    window.dispatchEvent(new CustomEvent("excalidraw-file-opened", { detail: file.name }));
    return file.name;
  } catch (err: any) {
    if (err?.name === "AbortError") return null;
    throw err;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _writeToHandle(handle: FileSystemFileHandle, excalidrawAPI: any): Promise<string> {
  const elements = excalidrawAPI.getSceneElements();
  const appState = excalidrawAPI.getAppState();
  const files = excalidrawAPI.getFiles();
  const json = serializeAsJSON(elements, appState, files, "local");

  const writable = await handle.createWritable();
  await writable.write(new Blob([json], { type: "application/json" }));
  await writable.close();

  const name = handle.name;
  // Dispatch the same event the FS polyfill uses so App.tsx tracking stays in sync
  window.dispatchEvent(new CustomEvent("excalidraw-file-saved", { detail: name }));
  return name;
}
