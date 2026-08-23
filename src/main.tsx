import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { registerPyodideServiceWorker } from "./pyodide/serviceWorkerRegistration";
import "./styles.css";

async function bootstrap(): Promise<void> {
  await registerPyodideServiceWorker();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
