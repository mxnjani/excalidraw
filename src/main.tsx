import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeFile, readFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";

// Lazy-load App so @excalidraw/excalidraw is emitted as an async chunk,
// keeping the main entry bundle small and silencing the chunk-size warning.
const App = lazy(() => import("./App"));

// ─── External link interception ──────────────────────────────────────────────
// Tauri's WebView2 silently swallows window.open and target="_blank" links.
// We redirect them to the OS default browser via the opener plugin.
const _originalOpen = window.open.bind(window);
window.open = function (url?: string | URL, target?: string, features?: string) {
  if (typeof url === "string" && /^https?:\/\//.test(url)) {
    openUrl(url).catch(console.error);
    return null;
  }
  return _originalOpen(url, target, features);
} as typeof window.open;

document.addEventListener("click", (e) => {
  const anchor = (e.target as HTMLElement).closest("a");
  if (anchor?.href && /^https?:\/\//.test(anchor.href)) {
    e.preventDefault();
    openUrl(anchor.href).catch(console.error);
  }
});

// ─── FileSystem Access API polyfill ──────────────────────────────────────────
// WebView2 blocks the HTML5 File System Access API (showSaveFilePicker /
// showOpenFilePicker). We replace them with Tauri native dialog + fs plugins,
// giving Excalidraw transparent access to disk.

function buildWritable(destPath: string) {
  const parts: BlobPart[] = [];
  let isClosed = false;

  const stream = new WritableStream({
    write(chunk: any) {
      if (chunk && typeof chunk === "object" && "type" in chunk && chunk.type === "write") {
        parts.push(chunk.data);
      } else {
        parts.push(chunk);
      }
    },
    async close() {
      if (isClosed) return;
      isClosed = true;
      const blob = new Blob(parts);
      const buffer = await blob.arrayBuffer();
      await writeFile(destPath, new Uint8Array(buffer));
      window.dispatchEvent(new CustomEvent("excalidraw-file-saved", { detail: destPath.split(/[/\\]/).pop() ?? "Untitled" }));
    },
  });

  // Polyfill legacy FileSystemWritableFileStream `.write()` / `.close()` so
  // both `.pipeTo(stream)` and direct `stream.write()` calls work.
  Object.assign(stream, {
    write: async (chunk: any) => {
      if (isClosed) throw new Error("Stream closed");
      if (chunk && typeof chunk === "object" && "type" in chunk && chunk.type === "write") {
        parts.push(chunk.data);
      } else {
        parts.push(chunk);
      }
    },
    close: async () => {
      if (isClosed) return;
      isClosed = true;
      const blob = new Blob(parts);
      const buffer = await blob.arrayBuffer();
      await writeFile(destPath, new Uint8Array(buffer));
      window.dispatchEvent(new CustomEvent("excalidraw-file-saved", { detail: destPath.split(/[/\\]/).pop() ?? "Untitled" }));
    },
  });

  return stream;
}

function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    bmp: "image/bmp",
    ico: "image/x-icon",
    json: "application/json",
    excalidraw: "application/json",
    excalidrawlib: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
}

function buildFileHandle(filePath: string) {
  const name = filePath.split(/[/\\]/).pop() ?? "file";
  return {
    kind: "file" as const,
    name,
    isSameEntry: async (other: { name?: string }) => other?.name === name,
    getFile: async () => {
      const bytes = await readFile(filePath);
      window.dispatchEvent(new CustomEvent("excalidraw-file-opened", { detail: name }));
      return new File([bytes], name, { type: getMimeType(name) });
    },
    createWritable: async () => buildWritable(filePath),
  };
}

(window as any).showSaveFilePicker = async (options?: {
  suggestedName?: string;
  types?: Array<{ description?: string; accept?: Record<string, string[]> }>;
}) => {
  const parsedFilters = options?.types
    ?.map((t) => ({
      name: (t.description ?? "File").replace("Excalidraw file", "Excalidraw"),
      extensions: t.accept
        ? (Object.values(t.accept).flat() as string[]).map((e) => e.replace(/^\./, ""))
        : [],
    }))
    .filter((f) => f.extensions.length > 0);

  const filters = parsedFilters && parsedFilters.length > 0 ? parsedFilters : undefined;
  const filePath = await save({ filters, defaultPath: options?.suggestedName }).catch(() => null);

  if (!filePath) throw new DOMException("The user aborted a request.", "AbortError");
  return buildFileHandle(filePath);
};

(window as any).showOpenFilePicker = async (options?: {
  multiple?: boolean;
  types?: Array<{ description?: string; accept?: Record<string, string[]> }>;
}) => {
  // Note: Windows silently rejects complex filter arrays for open dialogs,
  // so we pass undefined to guarantee the dialog always opens.
  const result = await open({ multiple: options?.multiple ?? false, filters: undefined }).catch(() => null);

  if (!result) throw new DOMException("The user aborted a request.", "AbortError");

  const paths: string[] = Array.isArray(result) ? result : [result];
  if (paths.length === 0) throw new DOMException("The user aborted a request.", "AbortError");

  return paths.map(buildFileHandle);
};

// ─── App mount ───────────────────────────────────────────────────────────────
// Importing windowVisibility activates the dead-man's switch timer as a
// side-effect, ensuring the window is never permanently hidden if React fails.
import "./windowVisibility";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Suspense fallback={<div />}>
      <App />
    </Suspense>
  </React.StrictMode>,
);
