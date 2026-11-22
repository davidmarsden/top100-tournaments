// Renders the Season 29 Youth Cup cards to PNG (then converted to WebP).
// Usage: node s29-wcc-shot.js <output dir>
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || '.';
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1280, height: 1500 } });
  await page.goto('file://' + path.join(__dirname, 's29-yc-cards.html'));
  for (const id of ['register', 'format']) await (await page.$('#' + id)).screenshot({ path: path.join(out, `s29-yc-${id}.png`) });
  await browser.close();
})();
