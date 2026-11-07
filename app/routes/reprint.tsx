import "@/components/reprint/reprint.css";

import { appPath } from "@agent-native/core/client/api-path";
import { Outlet } from "react-router";

export function meta() {
  return [{ title: "ReprintLess · fix printed mistakes with labels" }];
}

/** Same DejaVu files as the PDF export, so the on-screen preview matches print. */
function FontFaces() {
  const faces = [
    ["RL Sans", "DejaVuSans", 400],
    ["RL Sans", "DejaVuSans-Bold", 700],
    ["RL Serif", "DejaVuSerif", 400],
    ["RL Serif", "DejaVuSerif-Bold", 700],
    ["RL Mono", "DejaVuSansMono", 400],
    ["RL Mono", "DejaVuSansMono-Bold", 700],
  ] as const;
  const css = faces
    .map(([family, file, weight]) => `@font-face{font-family:"${family}";src:url("${appPath(`/fonts/${file}.ttf`)}") format("truetype");font-weight:${weight};font-display:block;}`)
    .join("\n");
  return <style>{css}</style>;
}

export default function ReprintLayout() {
  return (
    <>
      <FontFaces />
      <Outlet />
    </>
  );
}
