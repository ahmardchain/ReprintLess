/**
 * Generates the demo PDFs in public/samples/ with pdf-lib.
 *   pnpm exec tsx scripts/make-samples.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const out = path.join(process.cwd(), "public", "samples");
const A4: [number, number] = [595.28, 841.89];
const hex = (h: string) => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};

async function flyer() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Sokoto Tech Meetup");
  const page = pdf.addPage(A4);
  const [W, H] = A4;
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const top = (y: number) => H - y;
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hex("#FFF7E8") });
  page.drawRectangle({ x: 0, y: top(160), width: W, height: 160, color: hex("#1F4D2B") });
  page.drawText("SOKOTO TECH MEETUP", { x: 48, y: top(96), size: 36, font: bold, color: hex("#FFFFFF") });
  page.drawText("Builders, students and founders from across the North-West", { x: 48, y: top(128), size: 13, font: reg, color: hex("#CFE3D2") });

  const ink = hex("#1F2A1F");
  const date = "Saturday, 5 December 2026";
  const dateW = bold.widthOfTextAtSize(date, 20);
  page.drawText(date, { x: 48, y: top(222), size: 20, font: bold, color: ink });
  // A separate text run on the same baseline, ~10pt after the date.
  page.drawText("UDUS Main Auditorium", { x: 48 + dateW + 10, y: top(222), size: 20, font: reg, color: hex("#B4441F") });
  page.drawText("Doors open 3:30 PM", { x: 48, y: top(252), size: 15, font: reg, color: ink });

  // Free space below the date block, then the programme.
  const body = [
    "Lightning talks from local builders",
    "Live demos: agents, payments and agritech",
    "Meet hiring teams and find a co-founder",
  ];
  body.forEach((t, i) => {
    page.drawCircle({ x: 54, y: top(392 + i * 30) + 4.5, size: 3, color: hex("#1F4D2B") });
    page.drawText(t, { x: 66, y: top(392 + i * 30), size: 14, font: reg, color: ink });
  });
  page.drawRectangle({ x: 48, y: top(640), width: W - 96, height: 110, color: hex("#F3E6CC") });
  page.drawText("Bring a laptop and a friend.", { x: 68, y: top(582), size: 18, font: bold, color: ink });
  page.drawText("Snacks, Wi-Fi and good company provided.", { x: 68, y: top(610), size: 13, font: reg, color: ink });
  page.drawLine({ start: { x: 48, y: top(770) }, end: { x: W - 48, y: top(770) }, thickness: 0.8, color: hex("#C9B48A") });
  page.drawText("See you on 5/12/2026! · Free entry", { x: 48, y: top(796), size: 12, font: reg, color: ink });
  writeFileSync(path.join(out, "flyer.pdf"), await pdf.save());
}

async function menu() {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle("Mama Put Kitchen");
  const fontDir = path.join(process.cwd(), "public", "fonts");
  const reg = await pdf.embedFont(readFileSync(path.join(fontDir, "DejaVuSans.ttf")), { subset: true });
  const bold = await pdf.embedFont(readFileSync(path.join(fontDir, "DejaVuSans-Bold.ttf")), { subset: true });
  const page = pdf.addPage(A4);
  const [W, H] = A4;
  const top = (y: number) => H - y;
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hex("#FFFDF6") });
  const ink = hex("#2B1D14");
  page.drawText("Mama Put Kitchen", { x: 56, y: top(100), size: 32, font: bold, color: hex("#8A2E12") });
  page.drawText("Lunch menu · Daily 11am–4pm", { x: 56, y: top(128), size: 13, font: reg, color: ink });
  page.drawLine({ start: { x: 56, y: top(150) }, end: { x: W - 56, y: top(150) }, thickness: 1, color: hex("#8A2E12") });
  const items: [string, string][] = [
    ["Jollof Rice", "₦2,300"],
    ["Fried Rice", "₦2,200"],
    ["Chicken", "₦1,800"],
    ["Beef Suya", "₦1,500"],
    ["Pounded Yam & Egusi", "₦2,800"],
    ["Moi Moi", "₦700"],
    ["Dodo (fried plantain)", "₦600"],
    ["Zobo, 50cl", "₦500"],
  ];
  const right = W - 56;
  items.forEach(([name, price], i) => {
    const y = top(196 + i * 34);
    page.drawText(name, { x: 56, y, size: 15, font: reg, color: ink });
    page.drawText(price, { x: right - reg.widthOfTextAtSize(price, 15), y, size: 15, font: reg, color: ink });
  });
  const comboY = 196 + items.length * 34 + 24;
  page.drawRectangle({ x: 48, y: top(comboY + 14), width: W - 96, height: 38, color: hex("#F6E7C8") });
  const combo = "₦4,100";
  page.drawText("Combo: Jollof Rice + Chicken", { x: 56, y: top(comboY), size: 15, font: bold, color: ink });
  page.drawText(combo, { x: right - bold.widthOfTextAtSize(combo, 15), y: top(comboY), size: 15, font: bold, color: ink });
  page.drawText("Prices include VAT · Thank you for eating with us!", { x: 56, y: top(790), size: 11, font: reg, color: hex("#6B5847") });
  writeFileSync(path.join(out, "menu.pdf"), await pdf.save());
}

await flyer();
await menu();
console.log("Wrote public/samples/flyer.pdf and public/samples/menu.pdf");
