// Profile cards announcing new managers, by season and club. The images are in
// public/appointments/s<season>/ and their sources in docs/appointment-cards/. Shared by the
// public appointments page and the Top 100 Chat announcement (netlify/functions/chat-appointments.mjs).
export const CARDS = {
  28: {
    'Borussia Dortmund': { src: '/appointments/s28/card-scott.webp', manager: 'Scott Mckenzie' },
    'Atlético Madrid': { src: '/appointments/s28/card-simon.webp', manager: 'Simon Thomas' },
    'Hellas Verona': { src: '/appointments/s28/card-beddows.webp', manager: 'Sir Stephen Beddows' },
    Juventus: { src: '/appointments/s28/card-trx.webp', manager: 'Mister TRX' },
    // Round 2
    'São Paulo FC': { src: '/appointments/s28/card-neil.webp', manager: 'Neil Frankland' },
    Sampdoria: { src: '/appointments/s28/card-chris.webp', manager: 'Chris East' },
    'AC Milan': { src: '/appointments/s28/card-kevin.webp', manager: 'Kevin Trapp' },
    'Sevilla FC': { src: '/appointments/s28/card-shashi.webp', manager: 'Shashi P' },
    // Round 3
    'Udinese Calcio': { src: '/appointments/s28/card-giuseppe.webp', manager: 'Giuseppe Trovato' },
  },
};

const normalise = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// The card for a published appointment, only when the appointee is the manager on the card.
export function cardFor(season, vacancy) {
  if (!vacancy?.appointed) return null;
  const club = normalise(vacancy.club);
  const match = Object.entries(CARDS[season] || {}).find(([name]) => club.includes(normalise(name)) || normalise(name).includes(club));
  return match && normalise(vacancy.appointed).startsWith(normalise(match[1].manager)) ? match[1] : null;
}

// Club profile cards for open vacancies, by vacancy id (a club can be advertised in more than one
// round, with a different card each time). Images in public/vacancies/s<season>/, sources in
// docs/appointment-cards/. Shown in the Manager Portal and the Chat vacancy announcement.
export const VACANCY_CARDS = {
  17: { src: '/vacancies/s28/club-udinese.webp', club: 'Udinese Calcio' },
  18: { src: '/vacancies/s28/club-sevilla.webp', club: 'Sevilla FC' },
  19: { src: '/vacancies/s28/club-southampton.webp', club: 'Southampton' },
  20: { src: '/vacancies/s28/club-psv.webp', club: 'PSV' },
  21: { src: '/vacancies/s28/club-psg.webp', club: 'Paris Saint-Germain' },
};

// The card for an open vacancy, only when it is for the same club.
export function vacancyCardFor(vacancy) {
  const card = VACANCY_CARDS[Number(vacancy?.id)];
  return card && normalise(vacancy.club) === normalise(card.club) ? card : null;
}
