import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ForwardedRef,
} from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import type { InteractiveTerminalSession } from "../../compiler/InteractiveTerminalSession.js";

export interface TerminalViewHandle {
  clear: () => void;
  focus: () => void;
  write: (text: string) => void;
  writeln: (text?: string) => void;
}

interface TerminalViewProps {
  session?: InteractiveTerminalSession;
  notice?: string;
  onInputError?: (error: Error) => void;
  onInterrupt?: () => void;
}

function TerminalViewComponent(
  { session, notice, onInputError, onInterrupt }: TerminalViewProps,
  ref: ForwardedRef<TerminalViewHandle>,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
    if (session) terminalRef.current?.focus();
  }, [session]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "'Monaspace Neon', 'HarmonyOS Sans SC', ui-monospace, monospace",
      fontSize: 12.5,
      lineHeight: 1.35,
      minimumContrastRatio: 4.5,
      scrollback: 2_000,
      allowTransparency: true,
      theme: {
        background: "#101010",
        foreground: "#e5e5e5",
        cursor: "#f5f5f5",
        cursorAccent: "#101010",
        selectionBackground: "#52525288",
        black: "#171717",
        red: "#d4d4d4",
        green: "#b8b8b8",
        yellow: "#a3a3a3",
        blue: "#d4d4d4",
        magenta: "#b8b8b8",
        cyan: "#e5e5e5",
        white: "#f5f5f5",
        brightBlack: "#737373",
        brightRed: "#f5f5f5",
        brightGreen: "#e5e5e5",
        brightYellow: "#d4d4d4",
        brightBlue: "#e5e5e5",
        brightMagenta: "#d4d4d4",
        brightCyan: "#f5f5f5",
        brightWhite: "#ffffff",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    void document.fonts.load('12.5px "Monaspace Neon"').then(() => {
      if (terminalRef.current !== terminal) return;
      terminal.refresh(0, terminal.rows - 1);
      fitAddon.fit();
    });

    const input = terminal.onData((data) => {
      const current = sessionRef.current;
      if (!current) return;
      if (data === "\x03") {
        onInterrupt?.();
        return;
      }
      if (data === "\x04") {
        current.closeInput().catch((cause) =>
          onInputError?.(cause instanceof Error ? cause : new Error(String(cause))),
        );
        return;
      }
      current.write(data).catch((cause) =>
        onInputError?.(cause instanceof Error ? cause : new Error(String(cause))),
      );
    });

    const resize = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // The panel can briefly have zero height while it is collapsing.
      }
    });
    resize.observe(container);
    requestAnimationFrame(() => fitAddon.fit());

    return () => {
      input.dispose();
      resize.disconnect();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [onInputError, onInterrupt]);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => terminalRef.current?.clear(),
      focus: () => terminalRef.current?.focus(),
      write: (text) => terminalRef.current?.write(text),
      writeln: (text = "") => terminalRef.current?.writeln(text),
    }),
    [],
  );

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full overflow-hidden px-3 py-2" />
      {notice && (
        <div
          role="status"
          data-terminal-notice
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#101010] px-6 font-mono text-[11px] text-neutral-300"
        >
          {notice}
        </div>
      )}
    </div>
  );
}

export const TerminalView = forwardRef(TerminalViewComponent);
