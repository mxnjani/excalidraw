/**
 * fileOps.ts — Centralised save / open operations for the Excalidraw desktop app.
 *
 * Wraps the Tauri FS polyfills (window.showSaveFilePicker / showOpenFilePicker)
 * that are installed in main.tsx, tracking the "active" file handle so we can
 * do in-place saves without showing a dialog every time.
 */

import { serializeAsJSON } from "@excalidraw/excalidraw";
import { readFile } from "@tauri-apps/plugin-fs";

// The currently open file handle, or null if no file is associated.
let _activeHandle: FileSystemFileHandle | null = null;
let _activeFilePath: string | null = null;

export function getActiveFilePath(): string | null {
  return _activeFilePath;
}

export function clearActiveFile(): void {
  _activeHandle = null;
  _activeFilePath = null;
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
    _activeFilePath = (handle as any).__path || null;
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
    _activeFilePath = (handle as any).__path || null;
    // Dispatch the same event the FS polyfill uses so App.tsx tracking stays in sync
    window.dispatchEvent(new CustomEvent("excalidraw-file-opened", { 
      detail: { name: file.name, path: _activeFilePath } 
    }));
    return file.name;
  } catch (err: any) {
    if (err?.name === "AbortError") return null;
    throw err;
  }
}

/**
 * Load a specific absolute path directly (e.g. from Explorer via single-instance)
 */
export async function openFileFromPath(filePath: string, excalidrawAPI: any): Promise<void> {
  const bytes = await readFile(filePath);
  const text = new TextDecoder().decode(bytes);
  const data = JSON.parse(text);
  await excalidrawAPI.updateScene({
    elements: data.elements ?? [],
    appState: { ...(data.appState ?? {}), theme: excalidrawAPI.getAppState().theme },
    files: data.files ?? {},
  });
  
  // We need a handle for future saves to be in-place.
  // Since our polyfill has showOpenFilePicker/showSaveFilePicker, we can't easily 
  // construct a FileSystemFileHandle from a path without a dialog.
  // However, we can inject it if we expose buildFileHandle or similar.
  // For now, let's just use the polyfill to get a handle-like object.
  _activeFilePath = filePath;
  _activeHandle = (window as any).buildFileHandle ? (window as any).buildFileHandle(filePath) : null;

  const filename = filePath.split(/[/\\]/).pop() ?? "Untitled";
  window.dispatchEvent(new CustomEvent("excalidraw-file-opened", { 
    detail: { name: filename, path: filePath } 
  }));
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
  _activeFilePath = (handle as any).__path || null;

  // Dispatch the same event the FS polyfill uses so App.tsx tracking stays in sync
  window.dispatchEvent(new CustomEvent("excalidraw-file-saved", { 
    detail: { name, path: _activeFilePath } 
  }));
  return name;
}
