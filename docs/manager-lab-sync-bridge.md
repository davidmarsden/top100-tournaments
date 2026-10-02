# Manager Lab sync bridge

The public tournaments deployment remains the stable entry point used by existing saved Soccer Manager bookmarklets, but the active sync implementation now lives in the private `top100-manager-lab` deployment.

`sm-sync-router.js` is therefore a compatibility bridge to `https://lab.smtop100.blog/sm-sync-router.js`, and `sm-sync-collector.js` is a fallback compatibility bridge to the private collector while preserving the collector invocation token.

This prevents the public and private collector implementations drifting apart. Existing bookmarklets do not need to be replaced.
