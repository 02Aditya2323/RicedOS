/**
 * Linux Virtualization Runtime Subsystem
 *
 * Coordinates CheerpX x86 WebAssembly JIT virtualization, on-demand EXT2 block paging,
 * Copy-on-Write (COW) IndexedDB overlays, and bidirectional I/O streaming with xterm.js instances.
 */

import { Terminal } from "@xterm/xterm";

declare global {
  interface Window {
    CheerpX: any;
    __cheerpXPromise: Promise<any>;
  }
}

/**
 * Encapsulates an active, isolated terminal session running inside CheerpX.
 */
export interface TerminalSession {
  id: string;                                   // Unique session ID (e.g. "term-1")
  cx: any;                                     // CheerpX Linux instance reference
  sendInput: (code: number) => void;           // Function to feed character codes into Linux /dev/console stdin
  terminal: Terminal;                          // Associated xterm.js UI instance
  disposable?: { dispose: () => void };        // Keyboard event listener unbinder
}

export class LinuxRuntime {
  private static instance: LinuxRuntime | null = null;
  private CheerpX: any = null;
  private httpDevice: any = null;
  private baseInitPromise: Promise<void> | null = null;
  private isBaseReady = false;

  private sessions: Map<string, TerminalSession> = new Map();
  private activeSessionId: string | null = null;

  /**
   * Initializes the LinuxRuntime instance.
   * If an initialTerminal is supplied, sets the singleton instance immediately.
   *
   * @param {Terminal} [initialTerminal] - Optional initial xterm instance.
   */
  constructor(initialTerminal?: Terminal) {
    if (initialTerminal) {
      LinuxRuntime.instance = this;
    }
  }

  /**
   * Returns the global singleton instance of the LinuxRuntime execution manager.
   * Guarantees all terminal windows share the same cached block devices and runtime state.
   *
   * @returns {LinuxRuntime} The active singleton instance.
   */
  public static getInstance(): LinuxRuntime {
    if (!LinuxRuntime.instance) {
      LinuxRuntime.instance = new LinuxRuntime();
    }
    return LinuxRuntime.instance;
  }

  /**
   * Checks whether the base CheerpX engine and remote EXT2 block device are mounted and ready.
   *
   * @returns {boolean} True if the base image is loaded and ready for spawning processes.
   */
  public isReady(): boolean {
    return this.isBaseReady;
  }

  /**
   * Retrieves the identifier of the currently focused terminal pane or window.
   *
   * @returns {string | null} The active terminal window ID or null if none is open.
   */
  public getActivePaneId(): string | null {
    return this.activeSessionId;
  }

  /**
   * Initializes the CheerpX engine and attaches the read-only EXT2 base disk image.
   * 
   * SYSTEM MECHANISM:
   * Uses `CheerpX.HttpBytesDevice` to treat the remote `/linux.ext2` file (600MB) as an addressable
   * block device using HTTP 1.1 Range requests (chunk-by-chunk demand paging).
   * It downloads ONLY the requested 4KB blocks on-demand instead of fetching the entire 600MB file upfront.
   *
   * @param {(status: string) => void} [onStatus] - Optional status progress callback for UI notifications.
   * @returns {Promise<void>} Resolves once the base block device is mounted and cached.
   */
  public async initBase(onStatus?: (status: string) => void): Promise<void> {
    if (this.isBaseReady && this.httpDevice) {
      return;
    }

    if (this.baseInitPromise) {
      return this.baseInitPromise;
    }

    this.baseInitPromise = (async () => {
      try {
        onStatus?.("Waiting for CheerpX...");
        console.log("1. Waiting for CheerpX...");
        this.CheerpX = await window.__cheerpXPromise;

        console.log("2. CheerpX loaded");
        onStatus?.("Streaming Linux EXT2 image...");
        console.log("3. Loading Linux EXT2 image...");
        // Mount remote EXT2 filesystem image via HTTP Range requests
        this.httpDevice = await this.CheerpX.HttpBytesDevice.create("/linux.ext2");

        console.log("4. EXT2 image loaded and cached in memory");
        this.isBaseReady = true;
      } catch (error) {
        console.error("Failed to initialize base CheerpX device:", error);
        onStatus?.("Linux failed");
        this.baseInitPromise = null;
        throw error;
      }
    })();

    return this.baseInitPromise;
  }

  /**
   * Spawns an isolated interactive Linux shell session for a specific terminal window.
   *
   * ARCHITECTURAL PIPELINE:
   * 1. Awaits the shared base EXT2 image initialization.
   * 2. Creates a dedicated Copy-on-Write (COW) IndexedDB overlay (`IDBDevice`), ensuring
   *    writes (file creation, package installs) persist locally without altering the base image.
   * 3. Instantiates an independent CheerpX Linux container mounting EXT2, /dev, and /proc.
   * 4. Binds stdout/stderr via `cx.setCustomConsole` directly to `terminal.write()` in xterm.js.
   * 5. Binds stdin via `terminal.onData` directly to `sendInput(charCode)`.
   * 6. Launches `/bin/bash --login` under standard user credentials (UID 1000).
   *
   * @param {string} id - Unique terminal window ID (e.g. "term-1", "term-2").
   * @param {Terminal} terminal - The xterm.js instance bound to this window.
   * @param {(status: string) => void} [onStatus] - Optional status callback for UI topbar indicators.
   * @returns {Promise<void>}
   */
  public async spawnTerminal(
    id: string,
    terminal: Terminal,
    onStatus?: (status: string) => void
  ): Promise<void> {
    // 1. Ensure shared EXT2 image is loaded
    await this.initBase(onStatus);

    onStatus?.("Starting Linux shell...");

    try {
      // 2. Create persistent writable overlay for this terminal session (Copy-on-Write)
      const idbDevice = await this.CheerpX.IDBDevice.create(`weblinux-${id}`);
      const overlayDevice = await this.CheerpX.OverlayDevice.create(
        this.httpDevice,
        idbDevice
      );

      // 3. Create independent Linux execution environment for this pane
      const cx = await this.CheerpX.Linux.create({
        mounts: [
          {
            type: "ext2",
            path: "/",
            dev: overlayDevice,
          },
          {
            type: "devs",
            path: "/dev",
          },
          {
            type: "proc",
            path: "/proc",
          },
        ],
      });

      // 4. Connect console output directly to this pane's xterm instance
      const cols = terminal.cols > 0 ? terminal.cols : 80;
      const rows = terminal.rows > 0 ? terminal.rows : 24;

      const sendInput = cx.setCustomConsole(
        (buffer: Uint8Array) => {
          terminal.write(buffer);
        },
        cols,
        rows
      );

      // 5. Connect keyboard input from this xterm directly into this Linux instance
      const disposable = terminal.onData((data: string) => {
        this.activeSessionId = id;
        for (let i = 0; i < data.length; i++) {
          sendInput(data.charCodeAt(i));
        }
      });

      // Save session in registry
      const session: TerminalSession = {
        id,
        cx,
        sendInput,
        terminal,
        disposable,
      };
      this.sessions.set(id, session);
      this.activeSessionId = id;

      // 6. Launch Bash session in background with POSIX environment variables
      cx.run("/bin/bash", ["--login"], {
        env: [
          "HOME=/home/user",
          "USER=user",
          "SHELL=/bin/bash",
          "EDITOR=vim",
          "LANG=en_US.UTF-8",
          "LC_ALL=C",
        ],
        cwd: "/home/user",
        uid: 1000,
        gid: 1000,
      })
        .then((res: any) => {
          console.log(`[CheerpX] Bash on pane ${id} exited:`, res);
        })
        .catch((err: any) => {
          console.error(`[CheerpX] Bash process error on pane ${id}:`, err);
        });

      console.log(`[CheerpX] Linux shell running on pane ${id}!`);
      onStatus?.("Linux running");
    } catch (err) {
      console.error(`[CheerpX] Failed to spawn terminal ${id}:`, err);
      onStatus?.("Linux failed");
      throw err;
    }
  }

  /**
   * Sets the active keyboard focus to the specified terminal session and calls xterm focus().
   *
   * @param {string} id - Identifier of the terminal session to focus.
   */
  public focusTerminal(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;

    this.activeSessionId = id;
    session.terminal.focus();
  }

  /**
   * Closes and cleans up a terminal session.
   * Disposes the keyboard input listener, destroys the xterm DOM instance,
   * removes the session from the active registry, and transfers focus to remaining panes.
   *
   * @param {string} id - Identifier of the terminal session to close.
   */
  public closeTerminal(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;

    if (session.disposable) {
      session.disposable.dispose();
    }
    session.terminal.dispose();
    this.sessions.delete(id);

    // Auto-focus next available terminal window if the active one was closed
    if (this.activeSessionId === id) {
      const remaining = Array.from(this.sessions.keys());
      if (remaining.length > 0) {
        this.focusTerminal(remaining[remaining.length - 1]);
      } else {
        this.activeSessionId = null;
      }
    }
  }

  /**
   * Returns the count of currently active, concurrent terminal sessions.
   *
   * @returns {number} The number of active sessions.
   */
  public getPaneCount(): number {
    return this.sessions.size;
  }
}