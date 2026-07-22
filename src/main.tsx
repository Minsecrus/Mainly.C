import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Tooltip } from "radix-ui";

import "@fontsource-variable/mona-sans";
import "@fontsource/monaspace-neon/400.css";
import "@fontsource/monaspace-neon/400-italic.css";
import "@fontsource/monaspace-neon/700.css";
import App from "./App.js";
import "./fonts.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const ISOLATION_BOOTSTRAP_URL = new URL("bootstrap.svg", window.location.href).href;

function ToyIsolationLauncher() {
  const [ready, setReady] = useState(() => Boolean(navigator.serviceWorker?.controller));
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const serviceWorker = navigator.serviceWorker;
    if (!serviceWorker) return;
    const handleControllerChange = () => setReady(Boolean(serviceWorker.controller));
    serviceWorker.addEventListener("controllerchange", handleControllerChange);
    return () => serviceWorker.removeEventListener("controllerchange", handleControllerChange);
  }, []);

  async function copyLaunchUrl() {
    let copied = false;
    try {
      await navigator.clipboard.writeText(ISOLATION_BOOTSTRAP_URL);
      copied = true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = ISOLATION_BOOTSTRAP_URL;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      copied = document.execCommand("copy");
      textarea.remove();
    }
    setCopyStatus(copied ? "copied" : "failed");
    window.setTimeout(() => setCopyStatus("idle"), 2_000);
  }

  return (
    <main className="flex h-full items-center justify-center bg-[#090909] px-6 text-neutral-200">
      <section className="w-full max-w-lg rounded-2xl border border-white/[0.12] bg-white/[0.045] p-7 shadow-2xl shadow-black/40">
        <p className="mb-2 text-xs font-semibold tracking-[0.18em] text-rose-300">MAINLY.C</p>
        <h1 className="text-2xl font-semibold text-white">启动本地编译环境</h1>
        <p className="mt-4 text-sm leading-6 text-neutral-300">
          B站 Toy 使用跨域窗口展示内容，而浏览器端 Clang 需要线程隔离。点击下方按钮后，
          Mainly.C 会先准备独立的顶层隔离环境；代码、输入输出和编译过程仍只保存在你的浏览器中。
        </p>
        {ready ? (
          <div className="mt-6 space-y-3">
            <a
              className="flex h-10 w-full items-center justify-center rounded-lg bg-rose-300 px-5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-rose-200"
              href={ISOLATION_BOOTSTRAP_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              在新标签页启动（推荐）
            </a>
            <div className="grid grid-cols-2 gap-3">
              <a
                className="flex h-9 items-center justify-center rounded-lg border border-white/[0.14] bg-white/[0.055] px-3 text-xs font-medium text-neutral-200 transition-colors hover:bg-white/[0.09]"
                href={ISOLATION_BOOTSTRAP_URL}
                rel="noreferrer"
                target="_top"
              >
                在当前页启动
              </a>
              <button
                className="h-9 rounded-lg border border-white/[0.14] bg-white/[0.055] px-3 text-xs font-medium text-neutral-200 transition-colors hover:bg-white/[0.09]"
                onClick={() => void copyLaunchUrl()}
                type="button"
              >
                {copyStatus === "copied"
                  ? "已复制启动链接"
                  : copyStatus === "failed"
                    ? "复制失败，请长按链接"
                    : "复制启动链接"}
              </button>
            </div>
            <input
              aria-label="启动链接"
              className="h-8 w-full rounded-md border border-white/[0.1] bg-black/25 px-2 font-mono text-[10px] text-neutral-500 outline-none selection:bg-rose-300/30"
              onFocus={(event) => event.currentTarget.select()}
              readOnly
              value={ISOLATION_BOOTSTRAP_URL}
            />
          </div>
        ) : (
          <button
            className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-white/10 px-5 text-sm font-medium text-neutral-400"
            disabled
            type="button"
          >
            正在准备本地环境…
          </button>
        )}
        <p className="mt-4 text-xs leading-5 text-neutral-500">
          首次启动会加载约 32 MB 的本地 Clang 工具链，之后会优先使用浏览器缓存。
          如果 B站客户端没有打开新页面，请复制独立启动链接并粘贴到系统浏览器。
        </p>
      </section>
    </main>
  );
}

const needsToyIsolationLaunch = window.self !== window.top && !window.crossOriginIsolated;

createRoot(root).render(
  <StrictMode>
    {needsToyIsolationLaunch ? (
      <ToyIsolationLauncher />
    ) : (
      <Tooltip.Provider delayDuration={450} skipDelayDuration={120}>
        <App />
      </Tooltip.Provider>
    )}
  </StrictMode>,
);
