import { Terminal } from "@xterm/xterm";

declare global {
  interface Window {
    CheerpX: any;
    __cheerpXPromise: Promise<any>;
  }
}

export interface TerminalSession {
  id: string;
  cx: any;
  sendInput: (code: number) => void;
  terminal: Terminal;
  disposable?: { dispose: () => void };
}

export class LinuxRuntime {
  private static instance: LinuxRuntime | null = null;
  private CheerpX: any = null;
  private httpDevice: any = null;
  private baseInitPromise: Promise<void> | null = null;
  private isBaseReady = false;

  private sessions: Map<string, TerminalSession> = new Map();
  private activeSessionId: string | null = null;

  constructor(initialTerminal?: Terminal) {
    if (initialTerminal) {
      LinuxRuntime.instance = this;
    }
  }

  public static getInstance(): LinuxRuntime {
    if (!LinuxRuntime.instance) {
      LinuxRuntime.instance = new LinuxRuntime();
    }
    return LinuxRuntime.instance;
  }

  public isReady(): boolean {
    return this.isBaseReady;
  }

  public getActivePaneId(): string | null {
    return this.activeSessionId;
  }

  /**
   * Initializes CheerpX engine and loads the read-only EXT2 base image ONCE.
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
   * Spawns an interactive shell for a terminal pane.
   * Uses the shared EXT2 device and connects direct I/O to the given xterm instance.
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
      // 2. Create persistent writable overlay for this terminal session
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

      // Save session
      const session: TerminalSession = {
        id,
        cx,
        sendInput,
        terminal,
        disposable,
      };
      this.sessions.set(id, session);
      this.activeSessionId = id;

      // 6. Launch Bash session in background
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
   * Focuses a terminal pane.
   */
  public focusTerminal(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;

    this.activeSessionId = id;
    session.terminal.focus();
  }

  /**
   * Disposes of a terminal session and cleans up.
   */
  public closeTerminal(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;

    if (session.disposable) {
      session.disposable.dispose();
    }
    session.terminal.dispose();
    this.sessions.delete(id);

    if (this.activeSessionId === id) {
      const remaining = Array.from(this.sessions.keys());
      if (remaining.length > 0) {
        this.focusTerminal(remaining[remaining.length - 1]);
      } else {
        this.activeSessionId = null;
      }
    }
  }

  public getPaneCount(): number {
    return this.sessions.size;
  }
}