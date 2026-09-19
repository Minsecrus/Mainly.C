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
import { useTheme } from "../../features/theme/ThemeProvider.js";
import { terminalTheme } from "../../features/theme/editorThemes.js";

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
  const { palette } = useTheme();
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

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
      theme: terminalTheme(paletteRef.current),
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

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme(palette);
  }, [palette]);

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
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-panel px-6 font-mono text-[11px] text-secondary"
        >
          {notice}
        </div>
      )}
    </div>
  );
}

export const TerminalView = forwardRef(TerminalViewComponent);
