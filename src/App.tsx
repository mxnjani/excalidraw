import { useState, useEffect, useRef } from "react";
import { Excalidraw, getSceneVersion } from "@excalidraw/excalidraw";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm } from "@tauri-apps/plugin-dialog";
import { showWindow, cancelFallback } from "./windowVisibility";
import { saveFile, saveFileAs, openFile, clearActiveFile } from "./fileOps";
import "./App.css";

function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [filename, setFilename] = useState("Untitled");
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(isDirty);
  const [lastSavedVersion, setLastSavedVersion] = useState(-1);

  // Keep ref in sync with state for stale-closure event listeners
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  // Show the window once the React component mounts (window starts hidden
  // via tauri.conf.json "visible": false to prevent white flash on boot).
  useEffect(() => {
    cancelFallback();
    showWindow().catch(console.error);
  }, []);

  // Sync native Window Title via Tauri
  useEffect(() => {
    const title = `Excalidraw - ${filename}${isDirty ? " *" : ""}`;
    getCurrentWindow().setTitle(title).catch(console.error);
  }, [filename, isDirty]);

  useEffect(() => {
    if (!excalidrawAPI) return;

    // Sync save/open events dispatched by fileOps.ts (and the FS polyfill)
    const handleFileSaved = (e: any) => {
      if (e.detail) setFilename(e.detail);
      setLastSavedVersion(getSceneVersion(excalidrawAPI.getSceneElements()));
      setIsDirty(false);
    };
    const handleFileOpened = (e: any) => {
      if (e.detail) setFilename(e.detail);
      setLastSavedVersion(getSceneVersion(excalidrawAPI.getSceneElements()));
      setIsDirty(false);
    };

    window.addEventListener("excalidraw-file-saved", handleFileSaved);
    window.addEventListener("excalidraw-file-opened", handleFileOpened);

    // Global hotkeys (captured before WebView2 can intercept them)
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey && !e.altKey;

      // Ctrl+N — new canvas (confirm if unsaved changes)
      if (ctrl && !e.shiftKey && e.code === "KeyN") {
        e.preventDefault(); e.stopImmediatePropagation();
        (async () => {
          if (isDirtyRef.current) {
            const ok = await confirm(
              "You have unsaved changes. Discard and create a new canvas?",
              { title: "Unsaved Changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" }
            );
            if (!ok) return;
          }
          excalidrawAPI.resetScene();
          setFilename("Untitled");
          setIsDirty(false);
          setLastSavedVersion(-1);
          clearActiveFile();
        })();
      }

      // Ctrl+S — smart save (in-place if file open, Save As otherwise)
      if (ctrl && !e.shiftKey && e.code === "KeyS") {
        e.preventDefault(); e.stopImmediatePropagation();
        saveFile(excalidrawAPI).catch(console.error);
      }

      // Ctrl+Shift+S — always Save As
      if (ctrl && e.shiftKey && e.code === "KeyS") {
        e.preventDefault(); e.stopImmediatePropagation();
        saveFileAs(excalidrawAPI).catch(console.error);
      }

      // Ctrl+O — open file (confirm if unsaved changes)
      if (ctrl && !e.shiftKey && e.code === "KeyO") {
        e.preventDefault(); e.stopImmediatePropagation();
        (async () => {
          if (isDirtyRef.current) {
            const ok = await confirm(
              "You have unsaved changes. Discard and open another file?",
              { title: "Unsaved Changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" }
            );
            if (!ok) return;
          }
          openFile(excalidrawAPI).catch(console.error);
        })();
      }

      // Alt+Shift+D — toggle theme
      if (e.altKey && e.shiftKey && e.code === "KeyD") {
        e.preventDefault(); e.stopImmediatePropagation();
        const theme = excalidrawAPI.getAppState().theme;
        excalidrawAPI.updateScene({ appState: { theme: theme === "dark" ? "light" : "dark" } });
      }
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("excalidraw-file-saved", handleFileSaved);
      window.removeEventListener("excalidraw-file-opened", handleFileOpened);
    };
  }, [excalidrawAPI]);

  const onChange = (elements: any) => {
    if (lastSavedVersion === -1) {
      setLastSavedVersion(getSceneVersion(elements));
      return;
    }
    const current = getSceneVersion(elements);
    if (current !== lastSavedVersion && !isDirty) setIsDirty(true);
    else if (current === lastSavedVersion && isDirty) setIsDirty(false);
  };

  return (
    <div className="App">
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        initialData={{ appState: { theme: "dark" } }}
        validateEmbeddable={true}
        onChange={onChange}
        UIOptions={{
          canvasActions: {
            // Hide built-in save/export — all file ops now live in our hotkeys
            saveToActiveFile: false,
            export: false,
          },
        }}
      />
    </div>
  );
}

export default App;
