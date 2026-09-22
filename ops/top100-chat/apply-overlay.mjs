#!/usr/bin/env node
/**
 * Applies the Top 100 private-chat overlay to the pinned rss.chat v0.6.14
 * server/code/rssnetwork.js.
 *
 * Overlay sections are incremental so an already-SSO-overlaid server can gain
 * later features (such as structured source bindings) without first restoring
 * a pristine upstream file.
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node apply-overlay.mjs /path/to/rssnetwork.js');
  process.exit(2);
}

let source = fs.readFileSync(target, 'utf8');
const changes = [];

function replaceOnce(label, from, to) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error('Overlay anchor not found: ' + label);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error('Overlay anchor is not unique: ' + label);
  source = source.replace(from, to);
  changes.push(label);
}

const needsLocalSso = !source.includes('TOP100 CHAT OVERLAY: local SSO');
const needsSourceBindings = !source.includes('TOP100 CHAT OVERLAY: source bindings');
const needsReplyPush = !source.includes('TOP100 CHAT OVERLAY: reply push');

if (!needsLocalSso && !needsSourceBindings && !needsReplyPush) {
  console.log('Top 100 Chat overlay already up to date; no changes made.');
  process.exit(0);
}

if (needsLocalSso) {
  replaceOnce(
    'crypto dependency',
    'const fs = require ("fs");\n',
    'const fs = require ("fs");\nconst crypto = require ("crypto"); // TOP100 CHAT OVERLAY: local SSO\n'
  );

  replaceOnce(
    'product identity',
    'var myVersion = "0.6.14", myProductName = "rss.network";',
    'var myVersion = "0.6.14", myProductName = "Top 100 Chat"; // TOP100 CHAT OVERLAY: product identity'
  );

  replaceOnce(
    'feed identity',
    '\t\theadElements.title = userRec.screenname + " on rss.network";\n\t\theadElements.link = config.urlServerForClient; //8/2/26 by DW\n\t\theadElements.description = "Posts by " + userRec.screenname + " on rss.network";\n',
    '\t\theadElements.title = userRec.screenname + " on " + config.productNameForDisplay; // TOP100 CHAT OVERLAY\n' +
    '\t\theadElements.link = config.urlServerForClient; //8/2/26 by DW\n' +
    '\t\theadElements.description = "Posts by " + userRec.screenname + " on " + config.productNameForDisplay; // TOP100 CHAT OVERLAY\n'
  );

  const helperAnchor = '\tfunction httpRequest (url, timeout, headers, callback) { //7/30/26 by DW\n';
  const helperIndex = source.indexOf(helperAnchor);
  if (helperIndex < 0) throw new Error('Overlay anchor not found: helper insertion');

  const helperBlock = [
    '\t// TOP100 CHAT OVERLAY: local SSO',
    '\tfunction localTop100Sso (managerId, email, displayName, callback) {',
    '\t\tconst numericManagerId = Number (managerId);',
    '\t\tconst cleanEmail = String (email || "").trim ().toLowerCase ();',
    '\t\tconst cleanDisplayName = String (displayName || "Top 100 manager").trim ().slice (0, 120);',
    '\t\tif ((!Number.isInteger (numericManagerId)) || (numericManagerId <= 0) || (!cleanEmail.includes ("@"))) {',
    '\t\t\tcallback ({message: "A valid Top 100 manager id and email are required."});',
    '\t\t\treturn;',
    '\t\t\t}',
    '\t\tfunction updateIdentity (userRec) {',
    '\t\t\tconst prefs = (userRec.prefs === undefined) ? {} : userRec.prefs;',
    '\t\t\tprefs.myFeedTitle = cleanDisplayName;',
    '\t\t\tprefs.myFeedDescription = "Top 100 manager";',
    '\t\t\tconst sqltext = "update users set emailAddress = " + davesql.encode (cleanEmail) + ", prefs = " + davesql.encode (JSON.stringify (prefs)) + " where screenname = " + davesql.encode (userRec.screenname) + ";";',
    '\t\t\tdavesql.runSqltext (sqltext, function (err) {',
    '\t\t\t\tif (err) { callback (err); return; }',
    '\t\t\t\tuserRec.emailAddress = cleanEmail;',
    '\t\t\t\tuserRec.prefs = prefs;',
    '\t\t\t\tcallback (undefined, userRec);',
    '\t\t\t\t});',
    '\t\t\t}',
    '\t\tconst screenname = "manager" + numericManagerId;',
    '\t\tgetUserInfoByScreenname (screenname, function (err, screennameUser) {',
    '\t\t\tif (err) { callback (err); return; }',
    '\t\t\tgetUserInfoByEmail (cleanEmail, function (err, emailUser) {',
    '\t\t\t\tif (err) { callback (err); return; }',
    '\t\t\t\tif (screennameUser !== undefined) {',
    '\t\t\t\t\tif ((emailUser !== undefined) && (emailUser.screenname !== screenname)) {',
    '\t\t\t\t\t\tcallback ({message: "That email address is already linked to another chat account."});',
    '\t\t\t\t\t\treturn;',
    '\t\t\t\t\t\t}',
    '\t\t\t\t\tupdateIdentity (screennameUser);',
    '\t\t\t\t\treturn;',
    '\t\t\t\t\t}',
    '\t\t\t\tif (emailUser !== undefined) {',
    '\t\t\t\t\tcallback ({message: "That email address is already linked to another chat account."});',
    '\t\t\t\t\treturn;',
    '\t\t\t\t\t}',
    '\t\t\t\tconst emailSecret = crypto.randomBytes (24).toString ("hex");',
    '\t\t\t\tconst prefs = {myFeedTitle: cleanDisplayName, myFeedDescription: "Top 100 manager"};',
    '\t\t\t\tconst values = {screenname, emailAddress: cleanEmail, emailSecret, prefs: JSON.stringify (prefs)};',
    '\t\t\t\tdavesql.runSqltext ("insert into users " + davesql.encodeValues (values), function (err) {',
    '\t\t\t\t\tif (err) { callback (err); return; }',
    '\t\t\t\t\tupdateSubscriptionListOnS3 ();',
    '\t\t\t\t\tcallback (undefined, {screenname, emailAddress: cleanEmail, emailSecret, prefs});',
    '\t\t\t\t\t});',
    '\t\t\t\t});',
    '\t\t\t});',
    '\t\t}',
    '',
    ''
  ].join ('\n');

  source = source.slice(0, helperIndex) + helperBlock + source.slice(helperIndex);
  changes.push('localhost Top 100 SSO helper');

  replaceOnce(
    'local SSO route',
    '\t\tcase "/localnewuser": //7/29/26 by CC -- #205\n',
    '\t\tcase "/localtop100sso": // TOP100 CHAT OVERLAY -- localhost only\n' +
    '\t\t\tif (requestIsFromThisMachine (theRequest)) {\n' +
    '\t\t\t\tlocalTop100Sso (params.managerid, params.email, params.displayname, httpReturn);\n' +
    '\t\t\t\t}\n' +
    '\t\t\telse {\n' +
    '\t\t\t\treturnError ({message: "localtop100sso only works from the server machine."});\n' +
    '\t\t\t\t}\n' +
    '\t\t\treturn (true);\n' +
    '\t\tcase "/localnewuser": //7/29/26 by CC -- #205\n'
  );
}

if (needsSourceBindings) {
  replaceOnce(
    'fresh database source bindings',
    '"create table if not exists items (id integer primary key, feedUrl text, author text collate nocase, inReplyTo integer, title text, link text, description text, pubDate text, enclosureUrl text, enclosureType text, enclosureLength integer, whenCreated text default current_timestamp, whenUpdated text default current_timestamp, markdowntext text, outlineJsontext text, flDeleted integer not null default 0);",',
    '"create table if not exists items (id integer primary key, feedUrl text, author text collate nocase, inReplyTo integer, title text, link text, description text, pubDate text, enclosureUrl text, enclosureType text, enclosureLength integer, whenCreated text default current_timestamp, whenUpdated text default current_timestamp, markdowntext text, outlineJsontext text, top100ObjectUrl text, top100ObjectType text, top100ObjectTitle text, flDeleted integer not null default 0);", // TOP100 CHAT OVERLAY: source bindings'
  );

  replaceOnce(
    'convertItem source bindings',
    '\t\t\tctReplies: convertNumber (theItem.ctReplies), //7/3/26 by CC\n',
    '\t\t\tctReplies: convertNumber (theItem.ctReplies), //7/3/26 by CC\n' +
    '\t\t\ttop100ObjectUrl: convertString (theItem.top100ObjectUrl), // TOP100 CHAT OVERLAY\n' +
    '\t\t\ttop100ObjectType: convertString (theItem.top100ObjectType), // TOP100 CHAT OVERLAY\n' +
    '\t\t\ttop100ObjectTitle: convertString (theItem.top100ObjectTitle), // TOP100 CHAT OVERLAY\n'
  );

  replaceOnce(
    'addItem source bindings',
    '\t\t\toutlineJsontext: itemRec.outlineJsontext,\n\t\t\tauthor: itemRec.author, //5/4/26 by DW\n',
    '\t\t\toutlineJsontext: itemRec.outlineJsontext,\n' +
    '\t\t\ttop100ObjectUrl: itemRec.top100ObjectUrl, // TOP100 CHAT OVERLAY\n' +
    '\t\t\ttop100ObjectType: itemRec.top100ObjectType, // TOP100 CHAT OVERLAY\n' +
    '\t\t\ttop100ObjectTitle: itemRec.top100ObjectTitle, // TOP100 CHAT OVERLAY\n' +
    '\t\t\tauthor: itemRec.author, //5/4/26 by DW\n'
  );

  replaceOnce(
    'updateItem source bindings',
    '\t\t\tadd ("outlineJsontext", itemRec.outlineJsontext);\n\t\t\tadd ("author", itemRec.author);\n',
    '\t\t\tadd ("outlineJsontext", itemRec.outlineJsontext);\n' +
    '\t\t\tadd ("top100ObjectUrl", itemRec.top100ObjectUrl); // TOP100 CHAT OVERLAY\n' +
    '\t\t\tadd ("top100ObjectType", itemRec.top100ObjectType); // TOP100 CHAT OVERLAY\n' +
    '\t\t\tadd ("top100ObjectTitle", itemRec.top100ObjectTitle); // TOP100 CHAT OVERLAY\n' +
    '\t\t\tadd ("author", itemRec.author);\n'
  );

  replaceOnce(
    'newPost source bindings',
    '\t\t\t\t\t\t\t\t\tmarkdowntext: trimTrailingBlankLines (postRec.markdowntext), //6/3/26 by DW; 7/20/26 by CC -- #192\n\t\t\t\t\t\t\t\t\tinReplyTo: postRec.inReplyTo,\n',
    '\t\t\t\t\t\t\t\t\tmarkdowntext: trimTrailingBlankLines (postRec.markdowntext), //6/3/26 by DW; 7/20/26 by CC -- #192\n' +
    '\t\t\t\t\t\t\t\t\ttop100ObjectUrl: postRec.top100ObjectUrl, // TOP100 CHAT OVERLAY\n' +
    '\t\t\t\t\t\t\t\t\ttop100ObjectType: postRec.top100ObjectType, // TOP100 CHAT OVERLAY\n' +
    '\t\t\t\t\t\t\t\t\ttop100ObjectTitle: postRec.top100ObjectTitle, // TOP100 CHAT OVERLAY\n' +
    '\t\t\t\t\t\t\t\t\tinReplyTo: postRec.inReplyTo,\n'
  );
}

if (needsReplyPush) {
  const newPostAnchor = '\tfunction newPost (email, code, jsontext, callback) {\n';
  const newPostIndex = source.indexOf(newPostAnchor);
  if (newPostIndex < 0) throw new Error('Overlay anchor not found: reply push helper insertion');

  const helperBlock = [
    '\t// TOP100 CHAT OVERLAY: reply push',
    '\tfunction notifyTop100Reply (itemRec, userRec) {',
    '\t\tif ((itemRec.inReplyTo === undefined) || (itemRec.inReplyTo === null)) { return; }',
    '\t\tgetItemById (userRec.screenname, itemRec.inReplyTo, function (err, parentRec) {',
    '\t\t\tif (err || (parentRec === undefined) || (parentRec.author === userRec.screenname)) { return; }',
    '\t\t\tconst senderName = ((userRec.prefs !== undefined) && userRec.prefs.myFeedTitle) ? userRec.prefs.myFeedTitle : userRec.screenname;',
    '\t\t\tconst payload = {',
    '\t\t\t\trecipientScreenname: parentRec.author,',
    '\t\t\t\tsenderScreenname: userRec.screenname,',
    '\t\t\t\tsenderName,',
    '\t\t\t\treplyId: itemRec.id,',
    '\t\t\t\tparentId: itemRec.inReplyTo,',
    '\t\t\t\texcerpt: itemRec.markdowntext || itemRec.description || ""',
    '\t\t\t\t};',
    '\t\t\trequest.post ({url: "http://127.0.0.1:1470/internal/reply", json: payload, timeout: 3000}, function (err, response) {',
    '\t\t\t\tif (err) { console.log ("notifyTop100Reply: " + err.message); return; }',
    '\t\t\t\tif ((response !== undefined) && (response.statusCode >= 400)) { console.log ("notifyTop100Reply: gateway returned " + response.statusCode); }',
    '\t\t\t\t});',
    '\t\t\t});',
    '\t\t}',
    '',
    ''
  ].join ('\n');

  source = source.slice(0, newPostIndex) + helperBlock + source.slice(newPostIndex);
  changes.push('reply push helper');

  replaceOnce(
    'reply push trigger',
    '\t\t\t\t\t\t\t\t\t\t\t\titemRec.guid = getPermalinkUrl (itemRec); //6/20/26 by DW\n\t\t\t\t\t\t\t\t\t\t\t\tcallback (undefined, itemRec);\n',
    '\t\t\t\t\t\t\t\t\t\t\t\titemRec.guid = getPermalinkUrl (itemRec); //6/20/26 by DW\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\tnotifyTop100Reply (itemRec, userRec); // TOP100 CHAT OVERLAY: reply push\n' +
    '\t\t\t\t\t\t\t\t\t\t\t\tcallback (undefined, itemRec);\n'
  );
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = target + '.pre-top100-overlay-' + timestamp;
fs.copyFileSync(target, backup);
fs.writeFileSync(target, source);

console.log('Patched ' + path.resolve(target));
console.log('Backup: ' + backup);
console.log('Applied ' + changes.length + ' overlay changes:');
for (const change of changes) console.log('  - ' + change);
