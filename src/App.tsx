import { useEffect, useRef, useState } from "react";

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

import { LinuxRuntime } from "./LinuxRuntime";

import "@xterm/xterm/css/xterm.css";

function App() {
  const terminalContainer =
    useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const [status, setStatus] =
    useState("Starting Linux...");

  useEffect(() => {
    if (!terminalContainer.current || startedRef.current) {
      return;
    }
    startedRef.current = true;

    const terminal = new Terminal({
      cursorBlink: true,

      convertEol: true,

      fontSize: 14,

      fontFamily:
        "JetBrains Mono, Menlo, Monaco, monospace",

      theme: {
        background: "#0b0b0b",
        foreground: "#ffffff",
        cursor: "#ffffff",
      },
    });

    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);

    terminal.open(
      terminalContainer.current
    );

    fitAddon.fit();

    const runtime =
      new LinuxRuntime(terminal);

    runtime
      .start()
      .then(() => {
        setStatus("Linux running");
      })
      .catch((error) => {
        console.error(
          "Linux startup failed:",
          error
        );

        setStatus("Linux failed");
      });

    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener(
      "resize",
      handleResize
    );

    return () => {
      window.removeEventListener(
        "resize",
        handleResize
      );

      terminal.dispose();
    };
  }, []);

  return (
    <div className="app">

      <header className="topbar">
        <span className="title">
          WebLinux
        </span>

        <span className="status">
          ● {status}
        </span>
      </header>

      <main
        ref={terminalContainer}
        className="terminal"
      />

    </div>
  );
}

export default App;