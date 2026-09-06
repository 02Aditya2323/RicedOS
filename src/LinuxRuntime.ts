import { Terminal } from "@xterm/xterm";

declare global {
  interface Window {
    CheerpX: any;
    __cheerpXPromise: Promise<any>;
  }
}

export class LinuxRuntime {
  private terminal: Terminal;
  private cx: any = null;

  constructor(terminal: Terminal) {
    this.terminal = terminal;
  }

  async start() {
    console.log("1. Waiting for CheerpX...");

    // Wait for the ESM module loaded by index.html
    const CheerpX = await window.__cheerpXPromise;

    console.log("2. CheerpX loaded");

    /*
     * Load our local EXT2 image.
     *
     * public/linux.ext2
     *        ↓
     * http://localhost:5173/linux.ext2
     */
    console.log("3. Loading Linux EXT2 image...");

    const httpDevice =
      await CheerpX.HttpBytesDevice.create(
        "/linux.ext2"
      );

    console.log("4. EXT2 image loaded");

    /*
     * Persistent writable storage.
     *
     * The original EXT2 remains read-only.
     * Changes are stored in IndexedDB.
     */
    const idbDevice =
      await CheerpX.IDBDevice.create(
        "weblinux-root"
      );

    console.log("5. IndexedDB device created");

    /*
     * Combine:
     *
     * Linux image
     *      +
     * IndexedDB changes
     *      ↓
     * writable Linux filesystem
     */
    const overlayDevice =
      await CheerpX.OverlayDevice.create(
        httpDevice,
        idbDevice
      );

    console.log("6. Overlay device created");

    /*
     * Create Linux environment.
     */
    this.cx = await CheerpX.Linux.create({
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

    console.log("7. Linux environment created");

    /*
     * Connect CheerpX → xterm.js
     *
     * Linux output arrives here.
     */
    const sendInput =
      this.cx.setCustomConsole(
        (buffer: Uint8Array) => {
          this.terminal.write(buffer);
        },
        this.terminal.cols,
        this.terminal.rows
      );

    /*
     * Connect xterm.js → CheerpX
     *
     * Keyboard input goes into Linux.
     */
    this.terminal.onData((data: string) => {
      for (let i = 0; i < data.length; i++) {
        sendInput(data.charCodeAt(i));
      }
    });

    console.log("8. Terminal connected");

    /*
     * Start Bash.
     */
    await this.cx.run(
      "/bin/bash",
      ["--login"],
      {
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
      }
    );

    console.log("9. Linux shell running!");
  }
}