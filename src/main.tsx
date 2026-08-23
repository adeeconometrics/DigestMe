import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerPyodideServiceWorker } from "./pyodide/serviceWorkerRegistration";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker only serves pyodide artifacts for the agent; it must not
// delay first paint, and registerPyodideServiceWorker swallows its own errors.
void registerPyodideServiceWorker();
