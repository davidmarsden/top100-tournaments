const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ deviceScaleFactor: 2 });
  await p.goto('file:///home/user/top100-tournaments/docs/appointment-cards/s28-career-charts.html');
  for (const id of ['dario','kevin','gav','luis']) await (await p.$('#'+id)).screenshot({ path: `${__dirname}/career-${id}.png` });
  await b.close();
})();
