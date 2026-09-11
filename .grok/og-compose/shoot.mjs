import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const html = pathToFileURL(resolve("/workspace/.grok/og-compose/card.html")).href;
const out = "/workspace/.grok/og-compose/card.png";

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  });
  await page.goto(html, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => document.fonts.status === "loaded" && document.fonts.size > 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: out, type: "png", omitBackground: false });
  const box = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const p = document.querySelector("p");
    const mark = document.querySelector(".mark");
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
    };
    return { h1: r(h1), p: r(p), mark: r(mark), text: { title: h1.textContent, tag: p.textContent } };
  });
  console.log(JSON.stringify({ html, out, box }, null, 2));
} finally {
  await browser.close();
}
