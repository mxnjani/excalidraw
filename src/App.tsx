import { useState, useEffect } from "react";
import { Excalidraw, getSceneVersion } from "@excalidraw/excalidraw";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { showWindow, cancelFallback } from "./windowVisibility";
import "./App.css";

function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [filename, setFilename] = useState("Untitled");
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedVersion, setLastSavedVersion] = useState(-1);

  // Show the window once the React component mounts (window starts hidden
  // via tauri.conf.json "visible": false to prevent white flash on boot).
  useEffect(() => {
    cancelFallback();              // cancel the dead-man's timer
    showWindow().catch(console.error); // reveal the window (one-shot, safe to call multiple times)
  }, []);

  // Sync native Window Title via Tauri
  useEffect(() => {
    const title = `Excalidraw - ${filename}${isDirty ? " *" : ""}`;
    getCurrentWindow().setTitle(title).catch(console.error);
  }, [filename, isDirty]);

  useEffect(() => {
    if (!excalidrawAPI) return;

    // Sync save/open events broadcast from the FS polyfill
    const handleFileEvent = (e: any) => {
      if (e.detail) setFilename(e.detail);
      setLastSavedVersion(getSceneVersion(excalidrawAPI.getSceneElements()));
      setIsDirty(false);
    };

    window.addEventListener("excalidraw-file-saved", handleFileEvent);
    window.addEventListener("excalidraw-file-opened", handleFileEvent);

    // Global hotkey: Alt+Shift+D to toggle theme
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === "D" || e.key === "d" || e.code === "KeyD")) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const currentTheme = excalidrawAPI.getAppState().theme;
        excalidrawAPI.updateScene({ appState: { theme: currentTheme === "dark" ? "light" : "dark" } });
      }
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });

    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("excalidraw-file-saved", handleFileEvent);
      window.removeEventListener("excalidraw-file-opened", handleFileEvent);
    };
  }, [excalidrawAPI]);

  const onChange = (elements: any) => {
    if (lastSavedVersion === -1) {
      setLastSavedVersion(getSceneVersion(elements));
      return;
    }
    const currentVersion = getSceneVersion(elements);
    if (currentVersion !== lastSavedVersion && !isDirty) setIsDirty(true);
    else if (currentVersion === lastSavedVersion && isDirty) setIsDirty(false);
  };

  return (
    <div className="App">
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        initialData={{ appState: { theme: "dark" } }}
        validateEmbeddable={true}
        onChange={onChange}
      />
    </div>
  );
}

export default App;
