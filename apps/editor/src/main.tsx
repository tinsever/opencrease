import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/theme.css";
import "./styles/a11y.css";
import { Preview } from "./preview/PreviewPage";
import { installPreviewPublisher, parsePreviewPath } from "./preview/preview";
import { App } from "./App";
import { syncFromLocation } from "./state/workspace";
import { startBridge } from "./agent/bridge";
import { installPrefs } from "./state/prefs";
import { installDesktop } from "./desktop/install";
import { startWebMcp } from "./agent/webmcp";
import { checkSession } from "./auth/session";
import { SignIn } from "./auth/SignIn";

const root = createRoot(document.getElementById("root")!);

installPrefs();

void checkSession().then((state) => {
  if (state.kind === "locked") {
    root.render(
      <StrictMode>
        <SignIn />
      </StrictMode>,
    );
    return;
  }
  const preview = parsePreviewPath(location.pathname);
  if (preview) {
    root.render(<StrictMode><Preview {...preview} /></StrictMode>);
    return;
  }
  installPreviewPublisher();
  void syncFromLocation();
  startBridge();
  installDesktop();
  void startWebMcp();
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
