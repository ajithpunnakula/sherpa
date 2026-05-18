import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { installRendererLogForwarding } from "./lib/log";

installRendererLogForwarding();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
