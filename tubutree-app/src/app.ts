// Entry Point — Tubu Tree Mini App
import React from "react";
import { createRoot } from "react-dom/client";

// Styles
import "zmp-ui/zaui.css";
import "./css/app.scss";

// App Component
import App from "./components/app";
import appConfig from "../app-config.json";

if (!(window as any).APP_CONFIG) {
  (window as any).APP_CONFIG = appConfig;
}

const root = createRoot(document.getElementById("app")!);
root.render(React.createElement(App));
