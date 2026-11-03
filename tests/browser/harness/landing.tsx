import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces/full.css";
import "./harness.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LandingPage from "@/app/page";

/**
 * Browser-test harness for the public landing page. The page has no server-only
 * data, so the real component renders here unchanged (next/link is stubbed).
 */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
