// node --test tests/chat-digest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { digestKey, formatMarketDigest, hasNews, packageText, playerName, signDigest } from '../netlify/functions/lib/chatDigest.mjs';

const digest = {
  world: 'Top 100', from: '2026-11-01T00:00:00Z', to: '2026-11-02T18:41:00Z', deals: 3, totalFees: 42000000, typicalRatio: 1.89,
  biggest: [{ player: 'M.SILVETTI', rating: 81, age: 20, position: 'AM(RL),F(RLC)', from: 'Girondins Bordeaux', to: 'VfB Stuttgart', buyer: 'Rob Ryan', fee: 35000000, ratio: 21.875 }],
  dearest: { player: 'M.SILVETTI', rating: 81, age: 20, to: 'VfB Stuttgart', fee: 35000000, ratio: 21.875 },
  cheapest: null, partExchanges: 1, biggestPartExchange: { player: 'C.TALBI', rating: 86, from: 'FC Schalke 04', to: 'Dynamo Moskva', with: 'V.VALDEPEÑAS, V.JOSEPH' },
  newlyListed: [{ player: 'A.RÜDIGER', rating: 93, age: 33, position: 'D(C)', club: 'Bayern München', askingLabel: 'Part Exchange only' }], newlyListedCount: 1,
  newlyUnhappy: [], newlyUnhappyCount: 0,
  board: { wanted: 1, offered: 0, open: 1, latest: [{ kind: 'wanted', club: 'Hamburger SV', group: 'ST', minRating: 84, maxRating: 88, maxFee: 3500000, dealTypes: ['transfer', 'loan'] }] },
  newsfeed: [{ manager: 'Bojan H', club: 'Bayern München', message: 'Bayern TL: Doku, Rudiger' }],
};

test('formats the sections managers talk about', () => {
  const { title, markdown } = formatMarketDigest(digest, new Date('2026-11-02T18:41:00Z'));
  assert.equal(title, 'Top 100 market · Mon 2 Nov');
  assert.match(markdown, /3 completed deals since Sun 1 Nov, worth £42\.0m in cash and players/);
  assert.match(markdown, /• M\. Silvetti \(81, 20, AM\(RL\),F\(RLC\)\): Girondins Bordeaux → VfB Stuttgart \(Rob Ryan\) · £35\.0m/);
  assert.match(markdown, /21\.9× his value\. Worth it\?/);
  assert.equal(packageText({ fee: 1000000, total: 4000000, playersBack: [{ name: 'L.DIOUF', rating: 85 }] }), '£1.0m + L. Diouf (85), about £4.0m in all');
  assert.equal(packageText({ fee: 0, total: 3000000, playersBack: [{ name: 'L.DIOUF', rating: 85 }] }), 'L. Diouf (85), about £3.0m in all');
  assert.equal(packageText({ fee: 2500000 }), '£2.5m');
  assert.match(markdown, /with V\. Valdepeñas, V\. Joseph going the other way/);
  assert.match(markdown, /A\. Rüdiger \(93, 33, D\(C\)\), Bayern München, part exchange only/);
  assert.match(markdown, /Hamburger SV want a 84-88 rated striker \(transfer\/loan\), up to £3\.5m/);
  assert.match(markdown, /Bojan H, Bayern München: "Bayern TL: Doku, Rudiger"/);
  assert.ok(markdown.length <= 3800);
});

test('a quiet day is not posted', () => {
  assert.equal(hasNews({ deals: 0, newlyListedCount: 0, newlyUnhappyCount: 0, board: { wanted: 0, offered: 0 }, newsfeed: [] }), false);
  assert.equal(hasNews(digest), true);
});

test('long digests are trimmed to fit the chat limit, keeping the opening and the question', () => {
  const many = { ...digest, newsfeed: Array.from({ length: 3 }, () => ({ manager: 'A', club: 'B', message: 'x'.repeat(400) })),
    newlyListed: Array.from({ length: 5 }, () => ({ player: 'Y'.repeat(60), rating: 90, club: 'C'.repeat(60), askingLabel: 'Part Exchange only' })),
    biggest: Array.from({ length: 5 }, () => ({ ...digest.biggest[0], from: 'F'.repeat(60), to: 'T'.repeat(60) })) };
  const { markdown } = formatMarketDigest(many, new Date('2026-11-02T18:41:00Z'));
  assert.ok(markdown.length <= 3800);
  assert.match(markdown, /^3 completed deals/);
});

test('names, keys and signatures', () => {
  assert.equal(playerName('I.HANSEN-AARÖEN'), 'I. Hansen-Aaröen');
  assert.equal(playerName('Kevin KERS'), 'Kevin KERS');
  assert.equal(digestKey('top-100', new Date('2026-11-02T23:30:00Z')), 'top-100:market:2026-11-02');
  const secret = 's'.repeat(40), body = '{"key":"k"}';
  const { timestamp, signature } = signDigest(body, secret, 1793650000);
  const key = crypto.createHmac('sha256', secret).update('top100-chat-digest-v1').digest();
  assert.equal(signature, crypto.createHmac('sha256', key).update(`${timestamp}.${body}`).digest('base64url'));
});
