import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const DATA_RESET_VERSION = "clear-all-data-2026-05-14-v1";
const DATA_RESET_FLAG_KEY = "water-station-data-reset-version";
const EMPTY_APP_DATA = JSON.stringify({ customers: [], sales: [], payments: [], closings: [] });

function clearOldTabletDataOnce() {
  if (typeof window === "undefined" || !window.localStorage) return;
  if (window.localStorage.getItem(DATA_RESET_FLAG_KEY) === DATA_RESET_VERSION) return;

  window.localStorage.setItem("jordan-water-station-v1", EMPTY_APP_DATA);
  window.localStorage.setItem("water-station-pending-reports-v1", "[]");
  window.localStorage.removeItem("water-station-last-sync-state-v1");
  window.localStorage.setItem(DATA_RESET_FLAG_KEY, DATA_RESET_VERSION);
}

clearOldTabletDataOnce();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let refreshing = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js?v=custom-pricing-v16`)
      .then((registration) => registration.update())
      .catch(() => {
        // The app still works without offline caching; registration can fail on non-secure LAN URLs.
      });
  });
}
