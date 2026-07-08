import fs from 'node:fs';

const path = 'src/lib/spotlights.js';
let text = fs.readFileSync(path, 'utf8');

if (!text.includes('function diversifySpotlightTags')) {
  const insertBefore = 'export function fixtureSpotlights';
  const helper = `function storySide(entry, fallback) {
  return entry?.teams?.name ? describeManager(entry) : fallback;
}
function duplicateStory(match, duplicateIndex) {
  const group = match.groups?.code || 'group';
  const home = storySide(match.home_entry, match.home_placeholder || 'the home side');
  const away = storySide(match.away_entry, match.away_placeholder || 'the away side');
  const options = [
    { type: 'group-watch', tag: 'Group marker', story: `${home} and ${away} get an early chance to shape Group ${group}. It may not decide anything yet, but it should tell us plenty.` },
    { type: 'favourite-watch', tag: 'Favourite watch', story: `The seedings point one way, but ${home} still have to prove it on the pitch. These are the fixtures where favourites cannot afford to coast.` },
    { type: 'manager-angle', tag: 'Touchline angle', story: `${home} against ${away} gives both managers a useful early read on where their squads really stand.` },
    { type: 'early-marker', tag: 'Early marker', story: `No medals are won in the opening rounds, but a strong result here would immediately change the mood around Group ${group}.` },
  ];
  return options[duplicateIndex % options.length];
}
function diversifySpotlightTags(selected) {
  const seenTags = new Map();
  return selected.map((match) => {
    const key = match.spotlightTag || match.spotlightType || 'Spotlight';
    const count = seenTags.get(key) || 0;
    seenTags.set(key, count + 1);
    if (count === 0) return match;
    const rewrite = duplicateStory(match, count - 1);
    return { ...match, spotlightType: rewrite.type, spotlightTag: rewrite.tag, spotlightStory: rewrite.story };
  });
}

`;
  text = text.replace(insertBefore, helper + insertBefore);
}

text = text.replace('  return selected;\n}', '  return diversifySpotlightTags(selected);\n}');

fs.writeFileSync(path, text);
