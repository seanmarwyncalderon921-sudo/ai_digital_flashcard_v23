(() => {
  const installButtons = [...document.querySelectorAll(".pwa-install-btn")];
  if (!installButtons.length) return;

  let deferredPrompt = null;
  let toastTimer = null;
  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIos = (/iphone|ipad|ipod/i.test(window.navigator.userAgent)
    || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1)) && !window.MSStream;
  const isSecureAppOrigin = window.isSecureContext && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1");

  function showInstallHelp(message) {
    let toast = document.getElementById("pwa-install-help");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "pwa-install-help";
      toast.className = "app-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.append(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 6500);
  }

  function setInstallButtonsVisible(visible) {
    installButtons.forEach(button => button.classList.toggle("hidden", !visible));
  }

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).catch(error => {
        console.warn("App install support could not be initialized:", error?.message || error);
      });
    }, { once: true });
  }

  if (!isStandalone) setInstallButtonsVisible(true);

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
    setInstallButtonsVisible(true);
  });

  installButtons.forEach(installButton => installButton.addEventListener("click", async () => {
    if (!isSecureAppOrigin) {
      showInstallHelp("Install needs the app hosted on HTTPS. For local testing, open it at http://localhost:3000 instead of opening the HTML file directly.");
      return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") setInstallButtonsVisible(false);
      deferredPrompt = null;
      return;
    }
    if (isIos) {
      showInstallHelp("To install: tap Share in Safari, then choose Add to Home Screen.");
    } else {
      showInstallHelp("Open your browser menu and choose Install app or Add to Home Screen. If that option is missing, reload this HTTPS page in Chrome or Edge.");
    }
  }));

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    setInstallButtonsVisible(false);
    showInstallHelp("SAPC Reviewer was installed successfully.");
  });
})();
