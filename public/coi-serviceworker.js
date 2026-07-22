/*! Based on coi-serviceworker v0.1.7, licensed under MIT. */
const appShellFileName = "app-shell.data";
let coepCredentialless = false;

function isolatedResponse(response, navigation) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set(
    "Cross-Origin-Embedder-Policy",
    coepCredentialless ? "credentialless" : "require-corp",
  );
  if (!coepCredentialless) {
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  }
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (navigation) headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener("message", (event) => {
    if (event.data?.type === "deregister") {
      event.waitUntil(
        self.registration.unregister().then(() => self.clients.matchAll()).then((clients) => {
          for (const client of clients) client.navigate(client.url);
        }),
      );
    } else if (event.data?.type === "coepCredentialless") {
      coepCredentialless = event.data.value;
    }
  });

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

    const navigation = request.mode === "navigate";
    const source = navigation
      ? new Request(new URL(appShellFileName, self.registration.scope), {
          cache: "no-store",
          credentials: "same-origin",
        })
      : coepCredentialless && request.mode === "no-cors"
        ? new Request(request, { credentials: "omit" })
        : request;

    event.respondWith(
      fetch(source)
        .then((response) => isolatedResponse(response, navigation))
        .catch((error) => {
          console.error(error);
          return new Response("Unable to load the isolated application shell", { status: 502 });
        }),
    );
  });
} else {
  (() => {
    const coi = {
      shouldRegister: () => true,
      shouldDeregister: () => false,
      coepCredentialless: () => !(window.chrome || window.netscape),
      doReload: () => window.location.reload(),
      quiet: false,
      ...window.coi,
    };
    const serviceWorker = navigator.serviceWorker;

    if (serviceWorker?.controller) {
      serviceWorker.controller.postMessage({
        type: "coepCredentialless",
        value: coi.coepCredentialless(),
      });
      if (coi.shouldDeregister()) {
        serviceWorker.controller.postMessage({ type: "deregister" });
      }
    }

    if (window.crossOriginIsolated !== false || !coi.shouldRegister()) return;
    if (!window.isSecureContext || !serviceWorker) return;

    serviceWorker.register(document.currentScript.src).then(
      (registration) => {
        registration.addEventListener("updatefound", coi.doReload);
        if (registration.active && !serviceWorker.controller) coi.doReload();
      },
      (error) => {
        if (!coi.quiet) console.error("COOP/COEP Service Worker failed to register:", error);
      },
    );
  })();
}
