const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ deviceScaleFactor: 2 });
  await p.goto('file://' + process.argv[2] + '/cards.html');
  for (const id of ['scott','trx','beddows','simon']) await (await p.$('#'+id)).screenshot({ path: `${process.argv[2]}/card-${id}.png` });
  await b.close();
})();
