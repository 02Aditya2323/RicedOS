# WebLinux System Architecture & Technical Specification

This document provides an exhaustive, in-depth architectural breakdown of **WebLinux**, a full-fledged client-side Linux desktop environment running inside standard web browsers via WebAssembly, CheerpX x86 virtualization, xterm.js, and modern React/CSS glassmorphic UI systems.

---

## 1. High-Level System Architecture

```
+---------------------------------------------------------------------------------------------------+
|                                         USER BROWSER                                              |
|                                                                                                   |
|  +---------------------------------------------------------------------------------------------+  |
|  |                             REACT DESKTOP ENVIRONMENT (UI LAYER)                            |  |
|  |                                                                                             |  |
|  |  [ Waybar Topbar ]        [ Draggable / Cascading Windows ]            [ macOS Floating Dock ] |  |
|  |  * Clock / Battery        * Translucent Frosted Glass (blur)           * App Launchers         |  |
|  |  * Status Indicator       * Titlebar Controls (Min/Max/Close)          * Active Indicators     |  |
|  |  * Tray Sound Controls    * xterm.js Display Canvas / DOM              * Quick Terminal Spawn  |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                |                                                  |
|  +---------------------------------------------+-----------------------------------------------+  |
|  |                               MEDIA & WALLPAPER ENGINE                                      |  |
|  |  * Dual-layer background: Static Poster Underneath + Hardware-Accelerated <video> Layer    |  |
|  |  * Autoplay Handshake & Unmuted Policy Fallback Controller                                  |  |
|  |  * Background Music (BGM) Engine with Synchronized Master Gain & Mute Controls               |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                |                                                  |
|  +---------------------------------------------+-----------------------------------------------+  |
|  |                           TERMINAL VIRTUALIZATION & EXECUTION                               |  |
|  |                                                                                             |  |
|  |  [ xterm.js Emulator ] <==== (I/O Pipe) ====> [ Custom Console ABI ] <====> [ Bash Process ] |  |
|  |  * VT100/ANSI Parser                          * Uint8Array Buffer           * UID 1000 / user  |  |
|  |  * Dynamic Theme & Colorizer                  * Keycode Translators         * /bin/bash --login|  |
|  |  * FitAddon Auto-geometry                     * TTY cols/rows sizing        * Isolated sessions|  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                |                                                  |
|  +---------------------------------------------+-----------------------------------------------+  |
|  |                       CHEERPX WEBASSEMBLY VIRTUALIZATION ENGINE                             |  |
|  |  * x86-to-WASM Just-In-Time (JIT) Compilation Engine                                       |  |
|  |  * System Call Interception & Translation Layer (sys_read, sys_write, sys_fork, etc.)        |  |
|  |  * Virtual Memory Management Unit (MMU) & SharedArrayBuffer Threading                      |  |
|  +---------------------------------------------------------------------------------------------+  |
|                                                |                                                  |
|  +---------------------------------------------+-----------------------------------------------+  |
|  |                               MULTI-TIERED STORAGE SUBSYSTEM                                |  |
|  |                                                                                             |  |
|  |  +---------------------------+   +----------------------------+   +-----------------------+ |  |
|  |  |  HttpBytesDevice (Read)   |   |   IDBDevice (Overlay W)    |   |  WebLinuxMediaDB      | |  |
|  |  |  * On-demand HTTP Range   |   |   * Persistent Writes      |   |  * Binary Video Blobs | |  |
|  |  |  * 600MB EXT2 Image       |   |   * Inode & Block Delta    |   |  * Custom Audio (MP3) | |  |
|  |  |  * Zero full-download     |   |   * Independent per pane   |   |  * IDB Pointer System | |  |
|  |  +---------------------------+   +----------------------------+   +-----------------------+ |  |
|  +---------------------------------------------------------------------------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. Terminal Virtualization Subsystem

The terminal subsystem bridges the browser DOM with the virtualized Linux operating system running in WebAssembly. It is composed of three interconnected layers:

```
[ Browser Keystrokes ]
         |
         v
+-------------------+      onData(char)       +------------------------+
|     xterm.js      | -----------------------> |    LinuxRuntime.ts     |
| (Terminal Display |                          | (I/O Coordination Pipe)|
|  & ANSI Parser)   | <----------------------- +------------------------+
+-------------------+     terminal.write()                 |
                                                           | sendInput(code)
                                                           v
                                              +------------------------+
                                              |   CheerpX Custom Console|
                                              |       (TTY Driver)     |
                                              +------------------------+
                                                           |
                                                           v
                                              +------------------------+
                                              |    Virtual /bin/bash   |
                                              |  (Linux Userspace ELF) |
                                              +------------------------+
```

### 2.1 Component Breakdown

1. **xterm.js (`@xterm/xterm`)**:
   - Handles the client-side terminal presentation layer.
   - Parses ANSI/VT100 escape sequences emitted by Linux commands (colors, cursor positioning, screen clearing).
   - Utilizes `@xterm/addon-fit` to recalculate terminal geometry (`cols` and `rows`) on window resize or split.
   - Configured with `allowTransparency: true` and `background: "#00000000"`, allowing the underlying frosted glass window background and live video wallpaper to show through while maintaining text sharpness.

2. **CheerpX Custom Console Interface (`cx.setCustomConsole`)**:
   - Connects the standard I/O of the guest Linux virtual machine directly to JavaScript.
   - Takes a callback `(buffer: Uint8Array) => terminal.write(buffer)` which receives raw binary stdout/stderr bytes directly from the virtual TTY.
   - Provides a `sendInput(charCode: number)` function that injects keystrokes directly into the virtual `/dev/console` buffer.

3. **Multi-Terminal Session Isolation**:
   - `LinuxRuntime` is implemented as a singleton registry managing a collection of `TerminalSession` objects:
     ```ts
     interface TerminalSession {
       id: string;
       cx: any;
       sendInput: (code: number) => void;
       terminal: Terminal;
       disposable?: { dispose: () => void };
     }
     ```
   - Each terminal window (`term-1`, `term-2`, etc.) runs in an **independent execution container**.
   - If one terminal crashes, runs a long-running blocking script, or exits, other open terminal windows continue running without disruption.

4. **Dynamic Command & Text Colorization Engine**:
   - Rather than rebuilding or restarting the terminal, `xterm.js` options are mutated live via React effects:
     ```ts
     terminalRef.current.options.theme = {
       ...terminalRef.current.options.theme,
       foreground: termTextColor,
       cursor: termTextColor,
       white: termTextColor,
       brightWhite: termTextColor,
     };
     ```
   - All standard bash prompts, typed input commands, and uncolored program output dynamically adopt the user's selected palette in real time.

---

## 3. Storage Architecture: On-Demand Chunk Virtualization

A naive implementation of a browser-based Linux VM would download the entire root filesystem (`linux.ext2`, ~600MB) before booting. WebLinux eliminates this bottleneck through a **block-device virtualization architecture**.

### 3.1 The 600MB EXT2 Image: How Chunk-by-Chunk Execution Works

```
[ Virtual Linux Kernel (VFS) ]
              |
              | Inode / Block Read Request (e.g. read /bin/ls)
              v
[ CheerpX Overlay Device ]
              |
      +-------+-------------------------+
      | (Cache Miss in IDB)             | (Block Exists in IDB)
      v                                 v
[ HttpBytesDevice ]              [ IDBDevice ]
      |                          (Local IndexedDB Cache)
      | HTTP 1.1 Range Request
      | Range: bytes=2048000-2052095 (4KB block)
      v
[ Web Server (Vite / CDN) ]
```

1. **HTTP Range-Request Paging (`HttpBytesDevice`)**:
   - `HttpBytesDevice.create("/linux.ext2")` treats the remote 600MB file on the server as a raw block storage device.
   - When the virtualized Linux kernel requests a filesystem block (e.g. 4096 bytes corresponding to an ELF header or library symbol), CheerpX dispatches an HTTP request with a `Range` header:
     ```http
     GET /linux.ext2 HTTP/1.1
     Range: bytes=4194304-4198399
     ```
   - The server responds with `206 Partial Content` returning only the requested 4KB chunk.
   - **Result**: Booting Linux requires transferring less than **15MB to 25MB** of data instead of 600MB.

2. **Copy-on-Write (COW) Overlay (`OverlayDevice` & `IDBDevice`)**:
   - The base EXT2 image loaded over HTTP is read-only.
   - To support file creation (`touch`, `vim`), package installations, and user changes, CheerpX pairs the `HttpBytesDevice` with an `IDBDevice`:
     ```ts
     const idbDevice = await this.CheerpX.IDBDevice.create(`weblinux-${id}`);
     const overlayDevice = await this.CheerpX.OverlayDevice.create(
       this.httpDevice,
       idbDevice
     );
     ```
   - **Read Operations**: CheerpX checks the `IDBDevice` first. If modified blocks exist locally, they are returned. Otherwise, it fetches the original block from `HttpBytesDevice`.
   - **Write Operations**: Modified blocks are written exclusively to `IDBDevice` (IndexedDB). The remote base image is never touched.

---

## 4. Media Storage & Pointer Architecture

### 4.1 The LocalStorage 5MB Quota Problem

Browsers impose a strict synchronous storage quota on `localStorage` (typically **5MB to 10MB** per origin). 
- A standard 4K video wallpaper (`wallpaper.mp4`) is **44.5MB**.
- High-resolution anime/rice wallpapers are **2MB to 8MB**.
- Audio tracks (MP3) are **3MB to 10MB**.

Attempting to store raw Base64 data URLs in `localStorage` immediately throws:
```
Uncaught QuotaExceededError: Failed to execute 'setItem' on 'Storage': Setting the value exceeded the quota.
```

### 4.2 Two-Tier Storage Hierarchy

To solve this, WebLinux implements a hybrid storage architecture:

```
+-----------------------------------------------------------------------------+
|                                STORAGE SYSTEM                               |
|                                                                             |
|  +-----------------------------------+  +--------------------------------+  |
|  |     TIER 1: localStorage          |  |   TIER 2: IndexedDB            |  |
|  |     (Synchronous Metadata)        |  |   (Asynchronous Binary Blobs)  |  |
|  |                                   |  |                                |  |
|  |  * weblinux_wallpaper:            |  |  * DB: "WebLinuxMediaDB"       |  |
|  |    "idb:custom_wallpaper"        |  |  * Store: "media_blobs"        |  |
|  |  * weblinux_wallpaper_type:       |  |                                |  |
|  |    "video"                        |  |  Key: "custom_wallpaper"       |  |
|  |  * weblinux_bgm:                  |  |  Value: Blob (video/mp4, 44MB) |  |
|  |    "idb:custom_bgm"               |  |                                |  |
|  |  * weblinux_term_textcolor:       |  |  Key: "custom_bgm"             |  |
|  |    "#c0caf5"                      |  |  Value: Blob (audio/mp3, 5MB)  |  |
|  |  * weblinux_vol, opacity, blur... |  |                                |  |
|  +-----------------------------------+  +--------------------------------+  |
+-----------------------------------------------------------------------------+
```

1. **Pointer Dereferencing Flow**:
   - When a user uploads an MP4 video or MP3:
     1. The binary file is committed to IndexedDB via `saveMediaBlob(key, blob)`.
     2. A pointer string (`idb:custom_wallpaper` or `idb:custom_bgm`) is written to `localStorage`.
     3. An in-memory object URL (`blob:http://localhost:5173/...`) is generated via `URL.createObjectURL(blob)` for instantaneous UI consumption.
   - On page refresh:
     1. The React app reads the lightweight pointer from `localStorage`.
     2. If `wallpaper.startsWith("idb:")`, it calls `getMediaBlob("custom_wallpaper")`.
     3. Upon resolving the binary Blob from IndexedDB, it converts it into a browser Object URL.

2. **Safe LocalStorage Guard (`safeLocalStorageSet`)**:
   - Blocks any attempt to write payload strings larger than 50KB or strings beginning with `data:`, protecting against quota crashes.

---

## 5. Live Video Wallpaper & Media Subsystem

```
+-----------------------------------------------------------------------------+
|                     DESKTOP BACKGROUND RENDERING PIPELINE                   |
|                                                                             |
|  [ Layer 0: Root DOM Canvas ]                                               |
|  background: #000 (Base void)                                               |
|                                                                             |
|  [ Layer 1: .desktop-wallpaper (Static Underlay) ]                          |
|  background-image: url("/wallpaper.jpeg") or linear-gradient(...)            |
|  * Always rendered immediately on mount                                     |
|  * Eliminates black screen during video buffering                           |
|                                                                             |
|  [ Layer 2: .desktop-wallpaper-video (Hardware Overlay) ]                   |
|  <video autoPlay loop muted playsInline onLoadedData={...}>                 |
|  * Rendered when wallpaperType === "video"                                  |
|  * Uses GPU hardware acceleration (object-fit: cover)                       |
|  * Seamlessly fades in once frame 0 is decoded                              |
|                                                                             |
|  [ Layer 3: .desktop-overlay (Vignette Shader) ]                            |
|  background: radial-gradient(...)                                           |
|  * Provides contrast for desktop icons and text                             |
+-----------------------------------------------------------------------------+
```

### 5.1 The "Black Screen on Video Select" Bug & Resolution

Modern browsers enforce strict media autoplay policies:
1. **Unmuted Autoplay Policy**: Browsers block `<video autoplay>` if audio is unmuted and the user has not interacted with the document. If blocked, the video pauses at time zero.
2. **First Frame Decode Lag**: High-resolution videos (like 4K 60fps `wallpaper.mp4`) take 100ms–500ms to initialize hardware decoders. If no background image exists underneath, the canvas appears completely black.
3. **Blob URL Media Type Confusion**: `URL.createObjectURL(file)` returns a URL of the format `blob:http://localhost:5173/uuid` without a `.mp4` file extension. If the media detector checks only file extensions, it misidentifies the video as an image and passes it to CSS `background-image: url(...)`, which silently fails to render videos.

### 5.2 The Triple-Protection Solution

1. **Dual-Layer Rendering**: The `.desktop-wallpaper` div is always rendered underneath with a high-resolution poster fallback (`/wallpaper.jpeg`). Even if the video is buffering, the user sees the wallpaper image rather than black void.
2. **Explicit `wallpaperType` State**: Added an explicit state (`"video" | "image" | "gradient"`) stored in `localStorage` (`weblinux_wallpaper_type`) and restored alongside IndexedDB blobs, bypassing filename extension dependencies.
3. **Continuous Playback & Autoplay Fallback Handshake**:
   ```ts
   const playPromise = vid.play();
   if (playPromise !== undefined) {
     playPromise.catch(() => {
       // If unmuted autoplay blocked by browser policy, fall back to muted so video renders immediately
       if (!vid.muted) {
         vid.muted = true;
         setIsMuted(true);
         vid.play().catch(() => {});
       }
     });
   }
   ```
   If unmuted playback fails, it automatically switches to muted mode and plays immediately, guaranteeing visual rendering.

---

## 6. Desktop Environment & Hyprland Window Management

The desktop interface replicates modern Wayland/Hyprland tiling and floating window managers with macOS-style window controls.

### 6.1 State Orchestration

```ts
interface WindowItem {
  id: string;              // e.g. "term-1", "term-2"
  title: string;           // e.g. "Terminal 1"
  x: number;               // Left position in pixels
  y: number;               // Top position in pixels
  width: number;           // Width in pixels (default 740px)
  height: number;          // Height in pixels (default 460px)
  zIndex: number;          // Stacking elevation
  isMinimized: boolean;    // Hidden from viewport, icon lit in dock
  isMaximized: boolean;    // Full-screen overlay below topbar
}
```

- **Cascading Spawning**: Newly spawned windows offset their `(x, y)` coordinates diagonally (+35px, +25px) relative to the preceding window, preventing overlapping windows from hiding one another.
- **Z-Index Elevation**: Clicking or dragging any window elevates its `zIndex` above `maxZRef.current`, ensuring natural window focus.
- **Dynamic CSS Variables**:
  ```css
  --accent-color: #7aa2f7;
  --accent-glow: rgba(122, 162, 247, 0.4);
  --glass-blur: 36px;
  --window-bg: rgba(10, 13, 22, 0.25);
  ```
  Controls frosted glass blur intensity and window transparency globally across all components.

---

## 7. Browser Security & Isolation: COOP / COEP

WebAssembly multithreading and high-resolution timer access require a **cross-origin isolated environment** to mitigate side-channel timing attacks (Spectre/Meltdown).

WebLinux configures these HTTP headers in both `index.html` and `vite.config.ts`:
```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

- **`COOP: same-origin`**: Isolates the browsing context exclusively to same-origin documents. Cross-origin windows cannot open references to the WebLinux page.
- **`COEP: require-corp`**: Prevents the page from loading any cross-origin resource (scripts, images, video) unless that resource explicitly grants permission via Cross-Origin Resource Policy (CORP).

---

## 8. Summary of Subsystem Responsibilities

| Subsystem | Primary Technologies | Key Responsibility |
|---|---|---|
| **Virtualization Runtime** | CheerpX, WebAssembly, JIT | Runs x86 Linux binaries in browser, intercepts system calls |
| **Filesystem Streaming** | `HttpBytesDevice`, HTTP Range | Demand-pages 4KB blocks from remote 600MB EXT2 image |
| **Writable Storage** | `IDBDevice`, IndexedDB, COW | Persists file writes, installs, and user delta changes |
| **Terminal Emulation** | `xterm.js`, `FitAddon`, ANSI | Renders terminal grid, handles keystrokes, applies live themes |
| **Media & Assets** | `WebLinuxMediaDB`, Object URLs | Stores multi-megabyte videos and MP3s without quota crashes |
| **Wallpaper Engine** | HTML5 `<video>`, CSS Filters | Dual-layer video/poster rendering, unmuted autoplay recovery |
| **Window Management** | React, TypeScript, CSS Glass | Cascading windows, Waybar status bar, macOS-style dock |





x86 Linux binary
       ↓
CheerpX JIT
       ↓
WebAssembly
       ↓
Browser's WASM engine
       ↓
Actual execution



Linux_WASM/
├── index.html            --> Entry point, security headers (COOP/COEP), CheerpX loader
├── vite.config.ts        --> Dev server, CORS, headers for SharedArrayBuffer & ngrok
├── public/
│   ├── linux.ext2        --> 600MB Debian/x86 root filesystem disk image
│   ├── wallpaper.mp4     --> 4K live video wallpaper asset
│   └── wallpaper.jpeg    --> High-res fallback poster underlay
├── src/
│   ├── main.tsx          --> React DOM mount entry
│   ├── LinuxRuntime.ts   --> CORE ENGINE: CheerpX, virtual TTY, I/O pipeline, bash runner
│   ├── idbMedia.ts       --> STORAGE: IndexedDB binary storage for videos/audio
│   ├── App.tsx           --> UI & DESKTOP: Window manager, state, modals, media engine
│   ├── icons.tsx         --> Feather/Lucide-style bespoke SVG icons
│   └── index.css         --> Glassmorphism, CSS tokens, animations, Waybar & dock styles
└── docs/
    └── ARCHITECTURE.md   --> Full architectural specification document
