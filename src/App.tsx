import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { LinuxRuntime } from "./LinuxRuntime";
import "@xterm/xterm/css/xterm.css";

interface PaneItem {
  id: string;
  title: string;
}

interface TerminalPaneProps {
  pane: PaneItem;
  isActive: boolean;
  canClose: boolean;
  onFocus: () => void;
  onClose: () => void;
  onSplit: () => void;
  onStatusChange: (status: string) => void;
}

function TerminalPaneView({
  pane,
  isActive,
  canClose,
  onFocus,
  onClose,
  onSplit,
  onStatusChange,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const isSpawnedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || isSpawnedRef.current) return;
    isSpawnedRef.current = true;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 13,
      fontFamily: "JetBrains Mono, Menlo, Monaco, 'Courier New', monospace",
      theme: {
        background: "#0c0e14",
        foreground: "#c0caf5",
        cursor: "#7aa2f7",
        cursorAccent: "#0c0e14",
        selectionBackground: "rgba(122, 162, 247, 0.3)",
        black: "#15161e",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#bb9af7",
        cyan: "#7dcfff",
        white: "#a9b1d6",
        brightBlack: "#414868",
        brightRed: "#f7768e",
        brightGreen: "#9ece6a",
        brightYellow: "#e0af68",
        brightBlue: "#7aa2f7",
        brightMagenta: "#bb9af7",
        brightCyan: "#7dcfff",
        brightWhite: "#c0caf5",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const runtime = LinuxRuntime.getInstance();
    runtime
      .spawnTerminal(pane.id, terminal, onStatusChange)
      .then(() => {
        onStatusChange("Linux running");
        setTimeout(() => {
          fitAddon.fit();
          terminal.focus();
        }, 100);
      })
      .catch((err) => {
        console.error("Failed to spawn terminal:", err);
        onStatusChange("Linux failed");
      });

    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch (_) {}
    };

    window.addEventListener("resize", handleResize);

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      runtime.closeTerminal(pane.id);
    };
  }, [pane.id, onStatusChange]);

  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [isActive]);

  return (
    <div
      className={`terminal-pane ${isActive ? "active-pane" : "inactive-pane"}`}
      onClick={onFocus}
    >
      <div className="pane-header">
        <div className="pane-header-left">
          <span className="pane-dot dot-close" onClick={(e) => { e.stopPropagation(); if (canClose) onClose(); }} title="Close terminal" />
          <span className="pane-dot dot-minimize" title="Minimize" />
          <span className="pane-dot dot-maximize" title="Maximize" />
          <span className="pane-title">
            <span className="terminal-icon"></span> {pane.title}
          </span>
          {isActive && <span className="pane-badge">ACTIVE</span>}
        </div>

        <div className="pane-header-right">
          <button
            className="pane-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onSplit();
            }}
            title="Split Right (Alt+T / Super+Enter)"
          >
            <span className="btn-icon">⊞</span> Split
          </button>

          {canClose && (
            <button
              className="pane-action-btn pane-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              title="Close pane (Alt+W)"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div ref={containerRef} className="pane-body" />
    </div>
  );
}

function App() {
  const [panes, setPanes] = useState<PaneItem[]>([
    { id: "term-1", title: "Terminal 1" },
  ]);
  const [activePaneId, setActivePaneId] = useState<string>("term-1");
  const [status, setStatus] = useState("Starting Linux...");
  const [layout, setLayout] = useState<"columns" | "grid">("columns");
  const [currentTime, setCurrentTime] = useState("");

  const counterRef = useRef(1);

  // Live clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Spawn new terminal pane
  const spawnPane = useCallback(() => {
    counterRef.current += 1;
    const newId = `term-${counterRef.current}-${Date.now()}`;
    const newTitle = `Terminal ${counterRef.current}`;
    setPanes((prev) => [...prev, { id: newId, title: newTitle }]);
    setActivePaneId(newId);
  }, []);

  // Close pane
  const closePane = useCallback(
    (id: string) => {
      setPanes((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((p) => p.id !== id);
        if (activePaneId === id) {
          const nextActive = next[next.length - 1]?.id || "";
          setActivePaneId(nextActive);
          LinuxRuntime.getInstance().focusTerminal(nextActive);
        }
        return next;
      });
    },
    [activePaneId]
  );

  // Focus pane
  const focusPane = useCallback((id: string) => {
    setActivePaneId(id);
    LinuxRuntime.getInstance().focusTerminal(id);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Super+Enter or Alt+T or Ctrl+Shift+T: New Terminal
      if (
        (e.altKey && e.key.toLowerCase() === "t") ||
        (e.metaKey && e.key === "Enter") ||
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "t")
      ) {
        e.preventDefault();
        spawnPane();
      }

      // Alt+W or Ctrl+Shift+W: Close current terminal
      if (
        (e.altKey && e.key.toLowerCase() === "w") ||
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "w")
      ) {
        e.preventDefault();
        if (panes.length > 1 && activePaneId) {
          closePane(activePaneId);
        }
      }

      // Alt+ArrowRight / Alt+ArrowLeft: Switch focus
      if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        setPanes((currentPanes) => {
          const idx = currentPanes.findIndex((p) => p.id === activePaneId);
          if (idx === -1) return currentPanes;
          const nextIdx =
            e.key === "ArrowRight"
              ? (idx + 1) % currentPanes.length
              : (idx - 1 + currentPanes.length) % currentPanes.length;
          const targetId = currentPanes[nextIdx].id;
          setActivePaneId(targetId);
          LinuxRuntime.getInstance().focusTerminal(targetId);
          return currentPanes;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panes.length, activePaneId, spawnPane, closePane]);

  const isRunning = status === "Linux running";

  return (
    <div className="app">
      {/* Waybar Inspired Topbar */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="distro-brand">
            <span className="distro-logo">❄</span>
            <span className="distro-name">WebLinux</span>
          </div>

          <div className="workspaces">
            <button className="workspace-pill active-workspace">1</button>
            <button className="workspace-pill">2</button>
            <button className="workspace-pill">3</button>
          </div>

          <button
            className="spawn-btn"
            onClick={spawnPane}
            title="Spawn new terminal to the right (Alt+T or Super+Enter)"
          >
            <span className="btn-plus">+</span>
            <span>Split Right</span>
          </button>
        </div>

        <div className="topbar-center">
          <div className={`status-badge ${isRunning ? "status-running" : status.includes("failed") ? "status-failed" : "status-starting"}`}>
            <span className="status-dot" />
            <span className="status-text">{status}</span>
          </div>

          <div className="terminal-counter">
            <span>Panes: {panes.length}</span>
          </div>
        </div>

        <div className="topbar-right">
          <div className="layout-switcher">
            <button
              className={`layout-btn ${layout === "columns" ? "active" : ""}`}
              onClick={() => setLayout("columns")}
              title="Side-by-Side (Columns)"
            >
              Columns
            </button>
            <button
              className={`layout-btn ${layout === "grid" ? "active" : ""}`}
              onClick={() => setLayout("grid")}
              title="Grid Layout"
            >
              Grid
            </button>
          </div>

          <div className="shortcut-hint">
            <kbd>Alt+T</kbd> <span>Split</span>
            <kbd>Alt+W</kbd> <span>Close</span>
          </div>

          <div className="clock-widget">
            <span className="clock-time">{currentTime}</span>
          </div>
        </div>
      </header>

      {/* Main Multi-Terminal Tiling Area */}
      <main className={`terminals-container layout-${layout}`}>
        {panes.map((pane) => (
          <TerminalPaneView
            key={pane.id}
            pane={pane}
            isActive={pane.id === activePaneId}
            canClose={panes.length > 1}
            onFocus={() => focusPane(pane.id)}
            onClose={() => closePane(pane.id)}
            onSplit={spawnPane}
            onStatusChange={setStatus}
          />
        ))}
      </main>
    </div>
  );
}

export default App;