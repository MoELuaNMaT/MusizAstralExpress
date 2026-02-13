import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const isDevRuntime = /(localhost|127\.0\.0\.1|tauri\.localhost)$/i.test(window.location.hostname);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  isDevRuntime ? (
    <App />
  ) : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ),
);
