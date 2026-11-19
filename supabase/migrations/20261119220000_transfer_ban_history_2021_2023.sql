-- Transfer bans from October 2021 to July 2023, from the administrators' ban spreadsheet, filling
-- most of the gap in transfer_ban_history between the Transfer Bans page's 2019-2021 list and its
-- list from July 2023. Two of the spreadsheet's rows are already recorded (Walter Gogh, August
-- 2021; Pedro Vilar, July 2023) and are left out. The spreadsheet gives no offence level, so it is
-- taken from the length: about a month is level 1, two or three months level 2. Bans this old
-- can't change a ladder level (rule 4.1). Managers are linked where their record matched.

insert into public.transfer_ban_history (manager_id, manager_name, club_name, starts_on, ends_on, offence_level, kind, note)
select manager.id, v.manager_name, v.club_name, v.starts_on::date, v.ends_on::date,
  case when v.ends_on::date - v.starts_on::date > 45 then 2 else 1 end, 'squad_limit', v.note
from (values
  (75,   'Dario Saviano',   'Borussia Dortmund', '2021-10-10', '2021-11-09', 'Sell Álvaro BASTIDA.'),
  (null, 'J Walker',        'Crystal Palace',    '2021-10-29', '2021-11-28', 'Sell Gentil JADER.'),
  (68,   'Adam',            'Aston Villa',       '2022-04-07', '2022-05-07', 'Sell Adama TRAORÉ.'),
  (88,   'Hugo Costa',      'Celtic',            '2022-04-07', '2022-05-07', 'Sell Joe HUGILL.'),
  (null, 'DouDou',          'Schalke',           '2022-04-22', '2022-05-22', null),
  (112,  'Josh McMillan',   'Basel',             '2022-05-23', '2022-06-22', null),
  (480,  'Attilio Bonnici', 'Lokomotiv Moskva',  '2022-06-24', '2022-07-24', 'Sell MAGNANI.'),
  (480,  'Attilio Bonnici', 'Lokomotiv Moskva',  '2022-12-09', '2023-02-07', 'Sell BRUNNER.'),
  (94,   'Stephen Beddows', 'Sampdoria',         '2023-01-08', '2023-02-07', 'Sell MONTEVAGO.'),
  (88,   'Hugo Costa',      'Celtic',            '2023-01-16', '2023-02-15', 'Sell Kendry PAEZ.'),
  (135,  'Mark Phelps',     'Flamengo',          '2023-01-25', '2023-02-24', 'Sell CAMARGO.'),
  (80,   'yamil Mc02',      'Besiktas',          '2023-01-29', '2023-02-28', 'Sell MUZAMBO.'),
  (94,   'Stephen Beddows', 'Sampdoria',         '2023-02-20', '2023-05-21', 'Sell Youns EL HILALI.'),
  (138,  'Gursimran Brar',  'Köln',              '2023-06-17', '2023-07-07', 'Sell Bruce DEUWEL.'),
  (null, 'Nuno Bento',      'Partizan',          '2023-07-07', '2023-08-06', 'Sell Iacopo REGONESI.'),
  (null, 'Niall Taylor',    'Manchester United', '2023-07-30', '2023-08-29', 'Sell J. ADAMS.')
) v(manager_id, manager_name, club_name, starts_on, ends_on, note)
left join public.managers manager on manager.id = v.manager_id
on conflict (manager_name, starts_on) do nothing;
