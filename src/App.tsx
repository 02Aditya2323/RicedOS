import { useEffect, useRef, useState, useCallback, Component, ErrorInfo, ReactNode } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { LinuxRuntime } from "./LinuxRuntime";
import "@xterm/xterm/css/xterm.css";
import {
  IconTerminal,
  IconFolder,
  IconWallpaper,
  IconSettings,
  IconCpu,
  IconWifi,
  IconVolume,
  IconBattery,
  IconPlus,
  IconSliders,
  IconPalette,
  IconRefresh,
  IconX,
  IconCheck,
  IconTux,
  IconInfo,
  IconVolumeX,
  IconMusic,
  IconPlay,
  IconPause,
} from "./icons";
import { saveMediaBlob, getMediaBlob, safeLocalStorageSet } from "./idbMedia";

interface WindowItem {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
}

interface DesktopWindowProps {
  win: WindowItem;
  isActive: boolean;
  fontSize: number;
  termTextColor: string;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onStatusChange: (status: string) => void;
}

/**
 * DesktopWindow Component
 *
 * Represents an individual draggable, resizable, frosted-glass window containing an
 * embedded xterm.js terminal instance bound to a CheerpX Linux shell.
 *
 * ARCHITECTURAL ROLE:
 * - Mounts an xterm.js terminal instance inside an HTML container div.
 * - Attaches FitAddon and a ResizeObserver for dynamic terminal geometry adjustments.
 * - Invokes `LinuxRuntime.getInstance().spawnTerminal()` to spawn an isolated bash session.
 * - Live-synchronizes terminal text/command color and font size without restarting the shell.
 * - Provides window controls: Close, Minimize to Dock, Maximize/Restore, and Dragging.
 */
function DesktopWindow({
  win,
  isActive,
  fontSize,
  termTextColor,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  onDragStart,
  onStatusChange,
}: DesktopWindowProps) {
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
      fontSize: fontSize,
      fontFamily: "JetBrains Mono, Menlo, Monaco, 'Courier New', monospace",
      allowTransparency: true,
      theme: {
        background: "#00000000",
        foreground: termTextColor,
        cursor: termTextColor,
        cursorAccent: "#0a0c12",
        selectionBackground: "rgba(122, 162, 247, 0.35)",
        black: "#15161e",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#bb9af7",
        cyan: "#7dcfff",
        white: termTextColor,
        brightBlack: "#414868",
        brightRed: "#f7768e",
        brightGreen: "#9ece6a",
        brightYellow: "#e0af68",
        brightBlue: "#7aa2f7",
        brightMagenta: "#bb9af7",
        brightCyan: "#7dcfff",
        brightWhite: termTextColor,
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
      .spawnTerminal(win.id, terminal, onStatusChange)
      .then(() => {
        onStatusChange("Linux running");
        setTimeout(() => {
          fitAddon.fit();
          terminal.focus();
        }, 120);
      })
      .catch((err) => {
        console.error("Failed to spawn terminal in window:", err);
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
      runtime.closeTerminal(win.id);
    };
  }, [win.id, fontSize, onStatusChange]);

  // Focus terminal input when active
  useEffect(() => {
    if (isActive && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [isActive]);

  // Dynamically update terminal text/command color live
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = {
        ...terminalRef.current.options.theme,
        foreground: termTextColor,
        cursor: termTextColor,
        white: termTextColor,
        brightWhite: termTextColor,
        background: "#00000000",
      };
    }
  }, [termTextColor]);

  // Dynamically update terminal font size live
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = fontSize;
      try {
        fitAddonRef.current?.fit();
      } catch (_) {}
    }
  }, [fontSize]);

  // Refit on maximize toggle
  useEffect(() => {
    if (fitAddonRef.current) {
      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
        } catch (_) {}
      }, 50);
    }
  }, [win.isMaximized, win.width, win.height]);

  if (win.isMinimized) {
    return null;
  }

  const windowStyle: React.CSSProperties = win.isMaximized
    ? {
        top: "42px",
        left: "0px",
        width: "100%",
        height: "calc(100% - 42px - 72px)",
        zIndex: win.zIndex,
        borderRadius: "0px",
      }
    : {
        top: `${win.y}px`,
        left: `${win.x}px`,
        width: `${win.width}px`,
        height: `${win.height}px`,
        zIndex: win.zIndex,
      };

  return (
    <div
      className={`desktop-window ${isActive ? "active-window" : "inactive-window"}`}
      style={windowStyle}
      onMouseDown={onFocus}
    >
      <div className="window-titlebar" onMouseDown={onDragStart}>
        <div className="window-controls">
          <button
            className="window-dot dot-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="Close"
          />
          <button
            className="window-dot dot-minimize"
            onClick={(e) => {
              e.stopPropagation();
              onMinimize();
            }}
            title="Minimize"
          />
          <button
            className="window-dot dot-maximize"
            onClick={(e) => {
              e.stopPropagation();
              onMaximize();
            }}
            title="Maximize / Restore"
          />
        </div>

        <div className="window-title">
          <IconTerminal size={14} className="window-icon-svg" />
          <span className="window-text">{win.title} — bash</span>
        </div>

        <div className="window-status-pill">
          {isActive ? (
            <span className="pill-active">ACTIVE</span>
          ) : (
            <span className="pill-inactive">INACTIVE</span>
          )}
        </div>
      </div>

      <div ref={containerRef} className="window-content" />
    </div>
  );
}

/**
 * Media Type Detection Heuristic
 *
 * Determines whether a given wallpaper source string or Blob URL represents a video format.
 * Checks explicit wallpaperType overrides, MIME types (data:video/), and known video extensions.
 *
 * @param {string} src - The URL, Blob URL, or data URI of the media asset.
 * @param {string} [type] - Optional explicit type override ("video" | "image" | "gradient").
 * @returns {boolean} True if the media should be rendered via HTML5 <video>.
 */
const isVideoMedia = (src: string, type?: string): boolean => {
  if (type === "video") return true;
  if (!src) return false;
  if (src.startsWith("data:video/")) return true;
  const lower = src.toLowerCase();
  return (
    lower.endsWith(".mp4") ||
    lower.endsWith(".webm") ||
    lower.endsWith(".mov") ||
    lower.endsWith(".m4v") ||
    lower.endsWith(".mkv") ||
    lower.includes(".mp4?") ||
    lower.includes(".webm?")
  );
};

// Preset Wallpapers
const WALLPAPER_PRESETS = [
  {
    id: "p3-live-video",
    name: "Persona 3 (Live Video)",
    value: "/wallpaper.mp4",
    thumb: "/wallpaper.jpeg",
    type: "video",
  },
  {
    id: "p3-day",
    name: "Persona 3 (Train)",
    value: "/wallpaper.jpeg",
    thumb: "/wallpaper.jpeg",
    type: "image",
  },
  {
    id: "p3-night",
    name: "Persona 3 (Midnight)",
    value: "/wallpaper2.jpg",
    thumb: "/wallpaper2.jpg",
    type: "image",
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night Cyber",
    value: "linear-gradient(135deg, #16161e 0%, #1a1b26 50%, #24283b 100%)",
    thumb: "linear-gradient(135deg, #16161e 0%, #1a1b26 50%, #24283b 100%)",
    type: "gradient",
  },
  {
    id: "catppuccin",
    name: "Catppuccin Macchiato",
    value: "linear-gradient(135deg, #181926 0%, #24273a 50%, #363a4f 100%)",
    thumb: "linear-gradient(135deg, #181926 0%, #24273a 50%, #363a4f 100%)",
    type: "gradient",
  },
  {
    id: "nord-deep",
    name: "Nord Deep Aurora",
    value: "linear-gradient(135deg, #242933 0%, #2e3440 50%, #3b4252 100%)",
    thumb: "linear-gradient(135deg, #242933 0%, #2e3440 50%, #3b4252 100%)",
    type: "gradient",
  },
  {
    id: "synthwave",
    name: "Synthwave Sunset",
    value: "linear-gradient(135deg, #2b1055 0%, #58287f 40%, #a43878 75%, #e96379 100%)",
    thumb: "linear-gradient(135deg, #2b1055 0%, #58287f 40%, #a43878 75%, #e96379 100%)",
    type: "gradient",
  },
];

// Accent Color Presets
const ACCENT_PRESETS = [
  { name: "Tokyo Blue", value: "#7aa2f7" },
  { name: "Sakura Violet", value: "#bb9af7" },
  { name: "Emerald Lime", value: "#9ece6a" },
  { name: "Solar Amber", value: "#e0af68" },
  { name: "Cyber Cyan", value: "#7dcfff" },
  { name: "Crimson Coral", value: "#f7768e" },
];

// Terminal Text / Command Color Presets
const TERMINAL_COLOR_PRESETS = [
  { name: "Tokyo Ice (Default)", value: "#c0caf5", glow: "rgba(192, 202, 245, 0.45)" },
  { name: "Cyber Cyan", value: "#7dcfff", glow: "rgba(125, 207, 255, 0.45)" },
  { name: "Matrix Green", value: "#4ade80", glow: "rgba(74, 222, 128, 0.45)" },
  { name: "Retro Amber", value: "#f6c177", glow: "rgba(246, 193, 119, 0.45)" },
  { name: "Neon Pink", value: "#f7768e", glow: "rgba(247, 118, 142, 0.45)" },
  { name: "Sakura Purple", value: "#bb9af7", glow: "rgba(187, 154, 247, 0.45)" },
  { name: "Crisp White", value: "#f8fafc", glow: "rgba(248, 250, 252, 0.45)" },
  { name: "Hacker Emerald", value: "#00ff9f", glow: "rgba(0, 255, 159, 0.45)" },
];

function App() {
  const [windows, setWindows] = useState<WindowItem[]>([
    {
      id: "term-1",
      title: "Terminal 1",
      x: 100,
      y: 80,
      width: 740,
      height: 460,
      zIndex: 10,
      isMinimized: false,
      isMaximized: false,
    },
  ]);
  const [activeWindowId, setActiveWindowId] = useState<string>("term-1");
  const [status, setStatus] = useState("Starting Linux...");
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");

  // Settings & Rice State
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"wallpaper" | "appearance" | "terminal" | "system">("wallpaper");
  const [wallpaper, setWallpaper] = useState<string>(() => localStorage.getItem("weblinux_wallpaper") || "/wallpaper.mp4");
  const [wallpaperType, setWallpaperType] = useState<"video" | "image" | "gradient">(() => {
    const savedType = localStorage.getItem("weblinux_wallpaper_type");
    if (savedType === "video" || savedType === "image" || savedType === "gradient") {
      return savedType;
    }
    const savedWp = localStorage.getItem("weblinux_wallpaper") || "/wallpaper.mp4";
    if (isVideoMedia(savedWp)) return "video";
    if (savedWp.startsWith("linear-gradient") || savedWp.startsWith("radial-gradient")) return "gradient";
    return "image";
  });
  const [bgmAudio, setBgmAudio] = useState<string>(() => localStorage.getItem("weblinux_bgm") || "");
  const [bgmName, setBgmName] = useState<string>(() => localStorage.getItem("weblinux_bgm_name") || "");
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    const saved = localStorage.getItem("weblinux_muted");
    return saved !== null ? saved === "true" : true;
  });
  const [wallpaperVolume, setWallpaperVolume] = useState<number>(() => {
    const saved = localStorage.getItem("weblinux_vol");
    return saved !== null ? Number(saved) : 0.8;
  });
  const [accentColor, setAccentColor] = useState<string>(() => localStorage.getItem("weblinux_accent") || "#7aa2f7");
  const [glassOpacity, setGlassOpacity] = useState<number>(() => {
    const saved = localStorage.getItem("weblinux_opacity");
    if (saved === null) return 0.25;
    const num = Number(saved);
    return num > 0.4 ? 0.25 : num;
  });
  const [glassBlur, setGlassBlur] = useState<number>(() => {
    const saved = localStorage.getItem("weblinux_blur");
    if (saved === null) return 40;
    const num = Number(saved);
    return num < 30 ? 40 : num;
  });
  const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem("weblinux_fontsize")) || 13);
  const [termTextColor, setTermTextColor] = useState<string>(
    () => localStorage.getItem("weblinux_term_textcolor") || "#c0caf5"
  );
  const [customWallpaperUrl, setCustomWallpaperUrl] = useState("");

  const maxZRef = useRef(10);
  const counterRef = useRef(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgmFileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Sync video audio/mute/volume & ensure continuous playback
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    vid.volume = wallpaperVolume;
    vid.muted = isMuted;

    // Ensure video is playing
    const playPromise = vid.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        // If unmuted autoplay blocked by browser policy, fallback to muted playback
        if (!vid.muted) {
          vid.muted = true;
          setIsMuted(true);
          vid.play().catch(() => {});
        }
      });
    }
  }, [wallpaperVolume, isMuted, wallpaper, wallpaperType]);

  // Sync BGM audio/mute/volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = wallpaperVolume;
      audioRef.current.muted = isMuted;
      if (!isMuted) {
        audioRef.current.play().catch(() => {});
      }
    }
  }, [wallpaperVolume, isMuted, bgmAudio]);

  // Restore media from IndexedDB if user uploaded custom video/audio
  useEffect(() => {
    try {
      // Clean out any stale large base64 data URLs that caused quota issues
      const rawWp = localStorage.getItem("weblinux_wallpaper");
      if (rawWp && rawWp.startsWith("data:") && rawWp.length > 50000) {
        localStorage.removeItem("weblinux_wallpaper");
      }
      const rawBgm = localStorage.getItem("weblinux_bgm");
      if (rawBgm && rawBgm.startsWith("data:") && rawBgm.length > 50000) {
        localStorage.removeItem("weblinux_bgm");
      }

      if (rawWp === "idb:custom_wallpaper") {
        getMediaBlob("custom_wallpaper").then((blob) => {
          if (blob) {
            const isVid =
              blob.type.startsWith("video/") ||
              localStorage.getItem("weblinux_wallpaper_type") === "video";
            const newType = isVid ? "video" : "image";
            setWallpaperType(newType);
            safeLocalStorageSet("weblinux_wallpaper_type", newType);
            setWallpaper(URL.createObjectURL(blob));
          }
        });
      }

      if (rawBgm === "idb:custom_bgm") {
        getMediaBlob("custom_bgm").then((blob) => {
          if (blob) {
            setBgmAudio(URL.createObjectURL(blob));
          }
        });
      }
    } catch (e) {
      console.warn("Error restoring media from IndexedDB:", e);
    }
  }, []);

  // Safe Persistence
  useEffect(() => {
    if (!wallpaper.startsWith("blob:") && !wallpaper.startsWith("data:")) {
      safeLocalStorageSet("weblinux_wallpaper", wallpaper);
    }
  }, [wallpaper]);

  useEffect(() => {
    safeLocalStorageSet("weblinux_wallpaper_type", wallpaperType);
  }, [wallpaperType]);

  useEffect(() => {
    if (!bgmAudio.startsWith("blob:") && !bgmAudio.startsWith("data:")) {
      safeLocalStorageSet("weblinux_bgm", bgmAudio);
    }
  }, [bgmAudio]);

  useEffect(() => {
    safeLocalStorageSet("weblinux_bgm_name", bgmName);
  }, [bgmName]);

  useEffect(() => {
    safeLocalStorageSet("weblinux_muted", isMuted.toString());
  }, [isMuted]);

  useEffect(() => {
    safeLocalStorageSet("weblinux_vol", wallpaperVolume.toString());
  }, [wallpaperVolume]);

  useEffect(() => {
    safeLocalStorageSet("weblinux_accent", accentColor);
  }, [accentColor]);

  useEffect(() => {
    safeLocalStorageSet("weblinux_opacity", glassOpacity.toString());
  }, [glassOpacity]);

  useEffect(() => {
    safeLocalStorageSet("weblinux_blur", glassBlur.toString());
  }, [glassBlur]);

  useEffect(() => {
    safeLocalStorageSet("weblinux_fontsize", fontSize.toString());
  }, [fontSize]);

  useEffect(() => {
    safeLocalStorageSet("weblinux_term_textcolor", termTextColor);
  }, [termTextColor]);

  // Live clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
      setCurrentDate(
        now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  /**
   * Elevates a window's stacking order (z-index) to the top of the desktop.
   * Also transfers keyboard focus to the clicked window's Linux shell session.
   *
   * @param {string} id - Identifier of the window to focus and elevate.
   */
  const bringToFront = useCallback((id: string) => {
    maxZRef.current += 1;
    const newZ = maxZRef.current;
    setActiveWindowId(id);
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, zIndex: newZ, isMinimized: false } : w))
    );
    LinuxRuntime.getInstance().focusTerminal(id);
  }, []);

  /**
   * Spawns a new terminal window using a cascading offset layout (macOS style).
   * Generates a unique window ID, computes diagonal screen offsets, and registers the window state.
   */
  const spawnWindow = useCallback(() => {
    counterRef.current += 1;
    const id = `term-${counterRef.current}-${Date.now()}`;
    const title = `Terminal ${counterRef.current}`;
    maxZRef.current += 1;

    // Compute diagonal cascading offset so windows don't completely overlap
    const offsetIndex = (counterRef.current - 1) % 8;
    const initialX = Math.min(window.innerWidth - 760, 90 + offsetIndex * 36);
    const initialY = Math.min(window.innerHeight - 500, 75 + offsetIndex * 32);

    const newWin: WindowItem = {
      id,
      title,
      x: Math.max(20, initialX),
      y: Math.max(50, initialY),
      width: 740,
      height: 460,
      zIndex: maxZRef.current,
      isMinimized: false,
      isMaximized: false,
    };

    setWindows((prev) => [...prev, newWin]);
    setActiveWindowId(id);
  }, []);

  /**
   * Closes a terminal window and frees up its system resources.
   * Automatically reallocates focus to the next topmost open window.
   *
   * @param {string} id - Identifier of the window to close.
   */
  const closeWindow = useCallback(
    (id: string) => {
      setWindows((prev) => {
        const next = prev.filter((w) => w.id !== id);
        if (activeWindowId === id && next.length > 0) {
          const topRemaining = [...next].sort((a, b) => b.zIndex - a.zIndex)[0];
          setActiveWindowId(topRemaining.id);
          LinuxRuntime.getInstance().focusTerminal(topRemaining.id);
        }
        return next;
      });
    },
    [activeWindowId]
  );

  /**
   * Toggles the minimized state of a window (hiding it from the desktop canvas
   * while keeping its indicator alive in the floating dock).
   *
   * @param {string} id - Identifier of the window to minimize/restore.
   */
  const toggleMinimize = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isMinimized: !w.isMinimized } : w))
    );
  }, []);

  /**
   * Toggles a window between standard floating bounds and full-screen maximization
   * (snapped beneath the Waybar top status bar).
   *
   * @param {string} id - Identifier of the window to maximize/restore.
   */
  const toggleMaximize = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isMaximized: !w.isMaximized } : w))
    );
  }, []);

  /**
   * Initializes mouse drag interaction for moving a floating window across the desktop.
   * Elevates window z-index on mousedown and clamps window coordinates within screen boundaries.
   *
   * @param {React.MouseEvent} e - Mouse down event from the window titlebar.
   * @param {WindowItem} win - Window data model representing the target window.
   */
  const handleDragStart = (e: React.MouseEvent, win: WindowItem) => {
    if (win.isMaximized) return;
    bringToFront(win.id);

    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = win.x;
    const initialY = win.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      setWindows((prev) =>
        prev.map((w) =>
          w.id === win.id
            ? {
                ...w,
                x: Math.max(0, Math.min(window.innerWidth - 200, initialX + dx)),
                y: Math.max(42, Math.min(window.innerHeight - 100, initialY + dy)),
              }
            : w
        )
      );
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  /**
   * Handles user file uploads for custom wallpapers (image/video) or audio tracks.
   *
   * STORAGE PIPELINE:
   * - Detects MIME type and file extensions (audio vs video vs image).
   * - Generates an in-memory Object URL (`URL.createObjectURL(file)`) for instant UI response.
   * - Persists raw binary Blobs asynchronously to IndexedDB via `saveMediaBlob()`.
   * - Writes a pointer reference string (`idb:custom_wallpaper`) to localStorage,
   *   completely circumventing the 5MB browser localStorage quota limit.
   *
   * @param {React.ChangeEvent<HTMLInputElement>} e - File input change event.
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isAudioFile =
      file.type.startsWith("audio/") ||
      file.name.endsWith(".mp3") ||
      file.name.endsWith(".wav") ||
      file.name.endsWith(".ogg");

    const isVideoFile =
      file.type.startsWith("video/") ||
      file.name.endsWith(".mp4") ||
      file.name.endsWith(".webm") ||
      file.name.endsWith(".mov") ||
      file.name.endsWith(".mkv");

    const objectUrl = URL.createObjectURL(file);

    if (isAudioFile) {
      setBgmAudio(objectUrl);
      setBgmName(file.name);
      setIsMuted(false);
      saveMediaBlob("custom_bgm", file);
      safeLocalStorageSet("weblinux_bgm", "idb:custom_bgm");
      safeLocalStorageSet("weblinux_bgm_name", file.name);
    } else if (isVideoFile) {
      setWallpaperType("video");
      safeLocalStorageSet("weblinux_wallpaper_type", "video");
      setWallpaper(objectUrl);
      saveMediaBlob("custom_wallpaper", file);
      safeLocalStorageSet("weblinux_wallpaper", "idb:custom_wallpaper");
    } else {
      setWallpaperType("image");
      safeLocalStorageSet("weblinux_wallpaper_type", "image");
      setWallpaper(objectUrl);
      saveMediaBlob("custom_wallpaper", file);
      safeLocalStorageSet("weblinux_wallpaper", "idb:custom_wallpaper");
    }

    e.target.value = "";
  };

  /**
   * Dedicated file upload handler for background music (MP3) tracks.
   * Saves the audio Blob to IndexedDB, updates audio player state, and unmutes soundtrack.
   *
   * @param {React.ChangeEvent<HTMLInputElement>} e - File input change event.
   */
  const handleBgmUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    setBgmAudio(objectUrl);
    setBgmName(file.name);
    setIsMuted(false);
    saveMediaBlob("custom_bgm", file);
    safeLocalStorageSet("weblinux_bgm", "idb:custom_bgm");
    safeLocalStorageSet("weblinux_bgm_name", file.name);
  };

  // Global keybindings
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Super+Enter or Alt+T: Spawn terminal
      if (
        (e.altKey && e.key.toLowerCase() === "t") ||
        (e.metaKey && e.key === "Enter")
      ) {
        e.preventDefault();
        spawnWindow();
      }

      // Super+Q or Alt+W: Close active window
      if (
        (e.altKey && e.key.toLowerCase() === "w") ||
        (e.metaKey && e.key.toLowerCase() === "q")
      ) {
        e.preventDefault();
        if (activeWindowId) {
          closeWindow(activeWindowId);
        }
      }

      // Escape: Close settings modal if open
      if (e.key === "Escape" && showSettings) {
        setShowSettings(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWindowId, spawnWindow, closeWindow, showSettings]);

  const isRunning = status === "Linux running";
  const activeWin = windows.find((w) => w.id === activeWindowId);

  // Dynamic CSS variables for the theme
  const themeStyles = {
    "--accent-color": accentColor,
    "--accent-glow": `${accentColor}55`,
    "--glass-blur": `${glassBlur}px`,
    "--window-bg": `rgba(10, 13, 22, ${glassOpacity})`,
  } as React.CSSProperties;

  const isGradientWallpaper =
    wallpaper.startsWith("linear-gradient") || wallpaper.startsWith("radial-gradient");

  return (
    <div className="desktop-environment" style={themeStyles}>
      {/* Static/Poster fallback or Image/Gradient background */}
      <div
        className="desktop-wallpaper"
        style={{
          backgroundImage:
            wallpaperType === "gradient" || isGradientWallpaper
              ? wallpaper
              : wallpaperType === "video"
              ? `url("/wallpaper.jpeg")`
              : `url("${wallpaper}")`,
        }}
      />

      {/* Dynamic Live Video Wallpaper Background when active */}
      {(wallpaperType === "video" || isVideoMedia(wallpaper, wallpaperType)) && (
        <video
          ref={videoRef}
          key={wallpaper}
          className="desktop-wallpaper-video"
          src={wallpaper}
          autoPlay
          loop
          muted={isMuted}
          playsInline
          onLoadedData={(e) => {
            const vid = e.currentTarget;
            vid.play().catch(() => {
              vid.muted = true;
              setIsMuted(true);
              vid.play().catch(() => {});
            });
          }}
        />
      )}
      {bgmAudio && (
        <audio
          ref={audioRef}
          key={bgmAudio}
          src={bgmAudio}
          autoPlay
          loop
          muted={isMuted}
        />
      )}
      <div className="desktop-overlay" />

      {/* Modern Desktop Topbar */}
      <header className="desktop-topbar">
        <div className="topbar-left">
          <div className="os-badge">
            <IconTux size={18} className="os-logo-svg" />
            <span className="os-name">WebLinux</span>
          </div>

          <div className="active-app-indicator">
            <IconTerminal size={13} className="app-icon-indicator" />
            <span className="app-name">
              {activeWin ? activeWin.title : "Desktop"}
            </span>
          </div>
        </div>

        <div className="topbar-center">
          <div
            className={`status-chip ${
              isRunning
                ? "chip-running"
                : status.includes("failed")
                ? "chip-failed"
                : "chip-starting"
            }`}
          >
            <span className="chip-indicator" />
            <span className="chip-text">{status}</span>
          </div>
        </div>

        <div className="topbar-right">
          <button
            className="topbar-spawn-btn"
            onClick={spawnWindow}
            title="Open New Terminal Window (Super+Enter / Alt+T)"
          >
            <IconPlus size={14} />
            <span>Terminal</span>
          </button>

          <button
            className={`topbar-settings-btn ${showSettings ? "active" : ""}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Settings & Personalization"
          >
            <IconSliders size={14} />
            <span>Config</span>
          </button>

          <div className="system-tray">
            <span className="tray-item" title="WASM Linux Architecture: i386">
              <IconCpu size={15} />
            </span>
            <span className="tray-item" title="Network: Connected (Wasm Direct)">
              <IconWifi size={15} />
            </span>
            <button
              className="tray-item tray-btn"
              onClick={() => {
                const nextMuted = !isMuted;
                setIsMuted(nextMuted);
                if (!nextMuted) {
                  videoRef.current?.play().catch(() => {});
                  audioRef.current?.play().catch(() => {});
                }
              }}
              title={
                isMuted
                  ? "Wallpaper Audio: Muted (Click to Unmute)"
                  : `Wallpaper Audio: Active (${Math.round(wallpaperVolume * 100)}%)`
              }
            >
              {isMuted ? <IconVolumeX size={15} /> : <IconVolume size={15} />}
            </button>
            <span className="tray-item" title="Power: Online">
              <IconBattery size={15} />
            </span>
          </div>

          <div className="datetime-widget">
            <span className="date-str">{currentDate}</span>
            <span className="time-str">{currentTime}</span>
          </div>
        </div>
      </header>

      {/* Desktop Canvas & Icons */}
      <main className="desktop-canvas">
        <div className="desktop-icons-area">
          <div
            className="desktop-icon-item"
            onDoubleClick={spawnWindow}
            onClick={spawnWindow}
            title="Double click to launch Terminal"
          >
            <div className="icon-wrapper terminal-icon-wrap">
              <IconTerminal size={24} />
            </div>
            <span className="icon-label">Terminal</span>
          </div>

          <div
            className="desktop-icon-item"
            title="Virtual File Explorer"
            onClick={() => {
              if (windows.length === 0) spawnWindow();
            }}
          >
            <div className="icon-wrapper files-icon-wrap">
              <IconFolder size={24} />
            </div>
            <span className="icon-label">Files</span>
          </div>

          <div
            className="desktop-icon-item"
            title="Change Wallpaper & Themes"
            onClick={() => {
              setSettingsTab("wallpaper");
              setShowSettings(true);
            }}
          >
            <div className="icon-wrapper wallpaper-icon-wrap">
              <IconWallpaper size={24} />
            </div>
            <span className="icon-label">Wallpaper</span>
          </div>

          <div
            className="desktop-icon-item"
            title="System Settings & Config"
            onClick={() => {
              setSettingsTab("appearance");
              setShowSettings(true);
            }}
          >
            <div className="icon-wrapper settings-icon-wrap">
              <IconSettings size={24} />
            </div>
            <span className="icon-label">Settings</span>
          </div>
        </div>

        {/* Windows */}
        {windows.map((win) => (
          <DesktopWindow
            key={win.id}
            win={win}
            isActive={win.id === activeWindowId}
            fontSize={fontSize}
            termTextColor={termTextColor}
            onFocus={() => bringToFront(win.id)}
            onClose={() => closeWindow(win.id)}
            onMinimize={() => toggleMinimize(win.id)}
            onMaximize={() => toggleMaximize(win.id)}
            onDragStart={(e) => handleDragStart(e, win)}
            onStatusChange={setStatus}
          />
        ))}

        {/* Settings & Configuration Modal */}
        {showSettings && (
          <div
            className="settings-modal-backdrop"
            onClick={() => setShowSettings(false)}
          >
            <div
              className="settings-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="settings-header">
                <div className="settings-header-title">
                  <IconSliders size={18} className="settings-title-icon" />
                  <span>Desktop Settings & Configuration</span>
                </div>
                <button
                  className="settings-close-btn"
                  onClick={() => setShowSettings(false)}
                  title="Close Settings"
                >
                  <IconX size={16} />
                </button>
              </div>

              <div className="settings-body">
                {/* Navigation Sidebar */}
                <div className="settings-sidebar">
                  <button
                    className={`settings-nav-item ${settingsTab === "wallpaper" ? "active" : ""}`}
                    onClick={() => setSettingsTab("wallpaper")}
                  >
                    <IconWallpaper size={16} />
                    <span>Wallpaper</span>
                  </button>

                  <button
                    className={`settings-nav-item ${settingsTab === "appearance" ? "active" : ""}`}
                    onClick={() => setSettingsTab("appearance")}
                  >
                    <IconPalette size={16} />
                    <span>Appearance & Rice</span>
                  </button>

                  <button
                    className={`settings-nav-item ${settingsTab === "terminal" ? "active" : ""}`}
                    onClick={() => setSettingsTab("terminal")}
                  >
                    <IconTerminal size={16} />
                    <span>Terminal Config</span>
                  </button>

                  <button
                    className={`settings-nav-item ${settingsTab === "system" ? "active" : ""}`}
                    onClick={() => setSettingsTab("system")}
                  >
                    <IconInfo size={16} />
                    <span>System Specs</span>
                  </button>
                </div>

                {/* Tab Contents */}
                <div className="settings-content">
                  {/* WALLPAPER TAB */}
                  {settingsTab === "wallpaper" && (
                    <div className="settings-section">
                      <div className="section-title-wrap">
                        <h3>Wallpaper & Themes</h3>
                        <p>Pick a preset aesthetic, upload your own, or paste an image URL.</p>
                      </div>

                      <div className="wallpaper-presets-grid">
                        {WALLPAPER_PRESETS.map((preset) => {
                          const isSelected = wallpaper === preset.value;
                          return (
                            <div
                              key={preset.id}
                              className={`wallpaper-card ${isSelected ? "selected" : ""}`}
                              onClick={() => {
                                setWallpaper(preset.value);
                                const newType = preset.type as "video" | "image" | "gradient";
                                setWallpaperType(newType);
                                safeLocalStorageSet("weblinux_wallpaper_type", newType);
                              }}
                            >
                              <div className="wallpaper-preview">
                                {preset.type === "video" ? (
                                  <video
                                    src={preset.value}
                                    className="wallpaper-preview-media"
                                    muted
                                    loop
                                    autoPlay
                                    playsInline
                                  />
                                ) : (
                                  <div
                                    className="wallpaper-preview-bg"
                                    style={{
                                      backgroundImage:
                                        preset.type === "image"
                                          ? `url("${preset.thumb}")`
                                          : preset.thumb,
                                    }}
                                  />
                                )}
                                {preset.type === "video" && (
                                  <div className="live-badge">LIVE</div>
                                )}
                                {isSelected && (
                                  <div className="selected-badge">
                                    <IconCheck size={14} />
                                  </div>
                                )}
                              </div>
                              <span className="wallpaper-card-name">{preset.name}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Live Wallpaper & Audio Settings */}
                      <div className="live-audio-box">
                        <div className="live-audio-header">
                          <div className="live-audio-title">
                            <IconMusic size={16} className="audio-icon-highlight" />
                            <span>Live Wallpaper Sound & BGM</span>
                          </div>
                          <button
                            className={`pill-btn ${!isMuted ? "active" : ""}`}
                            onClick={() => {
                              const nextMuted = !isMuted;
                              setIsMuted(nextMuted);
                              if (!nextMuted) {
                                videoRef.current?.play().catch(() => {});
                                audioRef.current?.play().catch(() => {});
                              }
                            }}
                          >
                            {isMuted ? "Sound Muted" : "Sound Active"}
                          </button>
                        </div>

                        <div className="settings-row">
                          <div className="slider-label-row">
                            <label className="settings-label">Soundtrack & Video Volume</label>
                            <span className="slider-value">{Math.round(wallpaperVolume * 100)}%</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={wallpaperVolume}
                            onChange={(e) => setWallpaperVolume(Number(e.target.value))}
                            className="settings-slider"
                          />
                        </div>

                        {bgmAudio && (
                          <div className="bgm-active-row">
                            <span className="bgm-track-label">
                              ♪ BGM: {bgmName || "Custom Audio"}
                            </span>
                            <button
                              className="bgm-remove-btn"
                              onClick={() => {
                                setBgmAudio("");
                                setBgmName("");
                              }}
                              title="Stop and remove audio track"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="custom-wallpaper-box">
                        <label className="settings-label">
                          Upload Custom Video (MP4) / Music (MP3) or Image
                        </label>
                        <div className="custom-url-row">
                          <input
                            type="text"
                            className="settings-input"
                            placeholder="https://example.com/live-wallpaper.mp4 or image.jpg"
                            value={customWallpaperUrl}
                            onChange={(e) => setCustomWallpaperUrl(e.target.value)}
                          />
                          <button
                            className="settings-btn-primary"
                            onClick={() => {
                              const url = customWallpaperUrl.trim();
                              if (url) {
                                const isVid = isVideoMedia(url);
                                const isGrad = url.startsWith("linear-gradient") || url.startsWith("radial-gradient");
                                const newType = isVid ? "video" : isGrad ? "gradient" : "image";
                                setWallpaperType(newType);
                                safeLocalStorageSet("weblinux_wallpaper_type", newType);
                                setWallpaper(url);
                              }
                            }}
                          >
                            Apply URL
                          </button>
                          <button
                            className="settings-btn-secondary"
                            onClick={() => fileInputRef.current?.click()}
                            title="Upload local MP4 video or image"
                          >
                            Upload Video/Image
                          </button>
                          <input
                            type="file"
                            ref={fileInputRef}
                            style={{ display: "none" }}
                            accept="image/*,video/mp4,video/webm,video/*,audio/mp3,audio/wav,audio/*"
                            onChange={handleFileUpload}
                          />
                          <button
                            className="settings-btn-secondary"
                            onClick={() => bgmFileInputRef.current?.click()}
                            title="Upload MP3 for desktop background music"
                          >
                            <IconMusic size={14} />
                            <span>Upload MP3</span>
                          </button>
                          <input
                            type="file"
                            ref={bgmFileInputRef}
                            style={{ display: "none" }}
                            accept="audio/mp3,audio/wav,audio/ogg,audio/*"
                            onChange={handleBgmUpload}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* APPEARANCE & RICE TAB */}
                  {settingsTab === "appearance" && (
                    <div className="settings-section">
                      <div className="section-title-wrap">
                        <h3>Appearance & Hyprland Ricing</h3>
                        <p>Customize accent colors, window blur intensity, and transparency.</p>
                      </div>

                      <div className="settings-row">
                        <label className="settings-label">Accent Color Theme</label>
                        <div className="accent-picker-row">
                          {ACCENT_PRESETS.map((accent) => (
                            <button
                              key={accent.value}
                              className={`accent-color-btn ${accentColor === accent.value ? "selected" : ""}`}
                              style={{ backgroundColor: accent.value }}
                              onClick={() => setAccentColor(accent.value)}
                              title={accent.name}
                            >
                              {accentColor === accent.value && <IconCheck size={14} />}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="settings-row">
                        <div className="slider-label-row">
                          <label className="settings-label">Frosted Glass Blur</label>
                          <span className="slider-value">{glassBlur}px</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="80"
                          step="2"
                          value={glassBlur}
                          onChange={(e) => setGlassBlur(Number(e.target.value))}
                          className="settings-slider"
                        />
                      </div>

                      <div className="settings-row">
                        <div className="slider-label-row">
                          <label className="settings-label">Window Opacity</label>
                          <span className="slider-value">{Math.round(glassOpacity * 100)}%</span>
                        </div>
                        <input
                          type="range"
                          min="0.05"
                          max="0.95"
                          step="0.05"
                          value={glassOpacity}
                          onChange={(e) => setGlassOpacity(Number(e.target.value))}
                          className="settings-slider"
                        />
                      </div>
                    </div>
                  )}

                  {/* TERMINAL CONFIG TAB */}
                  {settingsTab === "terminal" && (
                    <div className="settings-section">
                      <div className="section-title-wrap">
                        <h3>Terminal Configuration</h3>
                        <p>Customize command text color, typography, and shell environment.</p>
                      </div>

                      {/* Command / Text Color Selection */}
                      <div className="settings-row">
                        <label className="settings-label">Command & Terminal Text Color</label>
                        <div className="term-color-picker-row">
                          {TERMINAL_COLOR_PRESETS.map((preset) => (
                            <button
                              key={preset.value}
                              className={`term-color-btn ${termTextColor === preset.value ? "selected" : ""}`}
                              style={{
                                backgroundColor: preset.value,
                                boxShadow: termTextColor === preset.value ? `0 0 12px ${preset.glow}` : "none",
                              }}
                              onClick={() => setTermTextColor(preset.value)}
                              title={`${preset.name} (${preset.value})`}
                            >
                              {termTextColor === preset.value && (
                                <IconCheck size={14} />
                              )}
                            </button>
                          ))}
                          <label className="term-color-custom-btn" title="Pick custom command color">
                            <input
                              type="color"
                              value={termTextColor}
                              onChange={(e) => setTermTextColor(e.target.value)}
                              className="term-color-input-native"
                            />
                            <span className="term-color-custom-label">Custom</span>
                          </label>
                        </div>
                      </div>

                      {/* Live Command Text Preview */}
                      <div className="settings-row">
                        <label className="settings-label">Live Command Preview</label>
                        <div className="term-preview-box">
                          <div className="term-preview-header">
                            <span className="term-preview-dot red" />
                            <span className="term-preview-dot yellow" />
                            <span className="term-preview-dot green" />
                            <span className="term-preview-title">user@weblinux: ~</span>
                          </div>
                          <div className="term-preview-body" style={{ color: termTextColor }}>
                            <div>
                              <span style={{ color: "#7aa2f7" }}>user@weblinux</span>:
                              <span style={{ color: "#7dcfff" }}>~</span>${" "}
                              <span style={{ color: termTextColor, fontWeight: 600 }}>
                                neofetch --stdout
                              </span>
                            </div>
                            <div style={{ opacity: 0.85, marginTop: "4px" }}>
                              Linux WebAssembly 6.1.0-x86_64
                            </div>
                            <div style={{ opacity: 0.85 }}>
                              CheerpX JIT • Virtualized Terminal Shell
                            </div>
                            <div style={{ marginTop: "4px" }}>
                              <span style={{ color: "#7aa2f7" }}>user@weblinux</span>:
                              <span style={{ color: "#7dcfff" }}>~</span>${" "}
                              <span
                                className="term-preview-cursor"
                                style={{ backgroundColor: termTextColor }}
                              >
                                &nbsp;
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="settings-row">
                        <label className="settings-label">Terminal Font Size</label>
                        <div className="font-size-options">
                          {[11, 12, 13, 14, 16].map((size) => (
                            <button
                              key={size}
                              className={`pill-btn ${fontSize === size ? "active" : ""}`}
                              onClick={() => setFontSize(size)}
                            >
                              {size}px
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="settings-row">
                        <label className="settings-label">Terminal Font Family</label>
                        <div className="font-family-badge">
                          JetBrains Mono, Menlo, Courier New, monospace
                        </div>
                      </div>

                      <div className="settings-row">
                        <label className="settings-label">Active Shell Instances</label>
                        <div className="active-terminals-stat">
                          {windows.length} terminal windows currently open
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SYSTEM SPECS TAB */}
                  {settingsTab === "system" && (
                    <div className="settings-section">
                      <div className="section-title-wrap">
                        <h3>System & CheerpX WASM Specs</h3>
                        <p>Underlying virtualization architecture and execution runtime.</p>
                      </div>

                      <div className="specs-table">
                        <div className="spec-row">
                          <span className="spec-key">Virtualization Engine</span>
                          <span className="spec-val">CheerpX 1.2.8 (x86 WebAssembly JIT)</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-key">Operating System</span>
                          <span className="spec-val">Debian GNU/Linux (i386 Architecture)</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-key">Root Filesystem</span>
                          <span className="spec-val">600MB ext2 Image with persistent overlay</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-key">Memory Isolation</span>
                          <span className="spec-val">Cross-Origin Isolated (COOP/COEP Enabled)</span>
                        </div>
                        <div className="spec-row">
                          <span className="spec-key">Active Linux Sessions</span>
                          <span className="spec-val">{windows.length} Processes</span>
                        </div>
                      </div>

                      <div className="specs-actions">
                        <button
                          className="settings-btn-secondary"
                          onClick={() => {
                            localStorage.clear();
                            window.location.reload();
                          }}
                        >
                          <IconRefresh size={14} />
                          <span>Reset Desktop to Default</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Mac/Hyprland Style Dock */}
      <footer className="desktop-dock">
        <div className="dock-container">
          <button
            className="dock-item"
            onClick={spawnWindow}
            title="Terminal (Click to spawn window)"
          >
            <span className="dock-icon terminal-dock">
              <IconTerminal size={22} />
            </span>
            {windows.length > 0 && <span className="dock-dot" />}
          </button>

          <button
            className="dock-item"
            onClick={spawnWindow}
            title="New Terminal Window"
          >
            <span className="dock-icon split-dock">
              <IconPlus size={22} />
            </span>
          </button>

          <div className="dock-divider" />

          <button
            className="dock-item"
            title="Files"
            onClick={() => {
              if (windows.length === 0) spawnWindow();
            }}
          >
            <span className="dock-icon files-dock">
              <IconFolder size={22} />
            </span>
          </button>

          <button
            className="dock-item"
            title="Change Wallpaper"
            onClick={() => {
              setSettingsTab("wallpaper");
              setShowSettings(true);
            }}
          >
            <span className="dock-icon wallpaper-dock">
              <IconWallpaper size={22} />
            </span>
          </button>

          <button
            className="dock-item"
            title="Settings & Config"
            onClick={() => {
              setSettingsTab("appearance");
              setShowSettings(true);
            }}
          >
            <span className="dock-icon settings-dock">
              <IconSettings size={22} />
            </span>
          </button>
        </div>
      </footer>
    </div>
  );
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("WebLinux caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            background: "#0a0d16",
            color: "#c0caf5",
            fontFamily: "'Inter', sans-serif",
            gap: 16,
            padding: 24,
            textAlign: "center",
          }}
        >
          <h2 style={{ color: "#ffffff", fontSize: 20 }}>WebLinux Desktop Recovery</h2>
          <p style={{ color: "#f7768e", maxWidth: 500, fontSize: 13, fontFamily: "monospace" }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            style={{
              padding: "9px 20px",
              background: "#7aa2f7",
              color: "#0a0c12",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
            }}
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
          >
            Reset Settings & Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}