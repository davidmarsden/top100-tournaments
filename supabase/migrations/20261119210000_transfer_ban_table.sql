-- The transfer bans table on smtop100.blog/transfer-bans/: the managers with the most bans, and
-- how long they've spent banned.
--
-- 1. transfer_ban_history gains the 55 bans from 2019 to 2021 listed on the Transfer Bans page,
--    so the table covers every ban on record (2019 to 2021, and from July 2023; the page lists none
--    in between). A ban that old can't affect a manager's ladder level (rule 4.1), which looks only
--    at the latest ban. Managers are linked where their record could be matched.
-- 2. public_transfer_ban_table(limit): readable without signing in, like the page itself. Bans per
--    manager (grouped by manager record, else by name), total time banned, longest single ban, the
--    latest ban, and whether one is in force; plus totals for the whole record.

-- The Sync tables come from Manager Lab's migrations, so SQL function bodies are not checked here.
set check_function_bodies = false;

insert into public.transfer_ban_history (manager_id, manager_name, club_name, starts_on, ends_on, offence_level, kind, note)
select manager.id, v.manager_name, v.club_name, v.starts_on::date, v.ends_on::date, v.level, v.kind, v.note
from (values
  (116, 'Walter Gogh', 'FK Partizan', '2021-08-24', '2021-09-23', 1, 'squad_limit', 'Walter Gogh (FK Partizan) - one month ban for first level offence from 24 August 2021 to 23 September 2021, and return the loan of Mohamad Simakan to parent club 24 August 2021.'),
  (500, 'Jamie Alldridge', 'Roma', '2021-06-03', '2021-07-02', 1, 'squad_limit', 'Jamie Alldridge (Roma) - one month ban for first level offence from 3 June 2021 to 2 July 2021, and sell Gaël KAKUTA external 12 August 2021.'),
  (97, 'Marco G', 'Twente', '2021-04-21', '2021-05-20', 1, 'squad_limit', 'Marco G (Twente) - one month ban for first level offence from 21 April 2021 to 20 May 2021, and sell Lorenzo LUCCA external 1 July 2021.'),
  (null, 'Andrew Achilleos', 'Shakhtar Donetsk', '2021-04-13', '2021-05-12', 1, 'squad_limit', 'Andrew Achilleos (Shakhtar Donetsk) - one month ban for first level offence from 13 April 2021 to 12 May 2021, and sell Issouf SISSOKHO external 22 June 2021.'),
  (null, 'Gary Naylor', 'Dynamo Kyiv', '2021-04-12', '2021-05-11', 1, 'squad_limit', 'Gary Naylor (Dynamo Kyiv) - one month ban for first level offence from 12 April 2021 to 11 May 2021, and sell Alan CARVALHO external 21 June 2021.'),
  (72, 'Scott Mckenzie', 'Sao Paulo', '2021-04-02', '2021-05-01', 1, 'squad_limit', 'Scott Mckenzie (Sao Paulo) - one month ban for first level offence from 2 April 2021 to 1 May 2021, and sell Marc CUCURELLA external 11 June 2021.'),
  (88, 'Hugo Costa', 'Celtic', '2021-01-27', '2021-02-26', 1, 'squad_limit', 'Hugo Costa (Celtic) - one month ban for first level offence from 27 January 2021 to 26 February 2021, and sell one of Ellis SIMMS or Yonas MALEDE 7 April 2021.'),
  (null, 'Mariano Ratero', 'Boca Juniors', '2020-11-26', '2021-02-25', 2, 'squad_limit', 'Mariano Ratero (Boca Juniors) - three month ban for second level offence from 26 November 2020 to 25 February 2021.'),
  (null, 'DouDou', 'Torino', '2021-01-15', '2021-02-14', 1, 'squad_limit', 'DouDou (Torino) - one month ban for first offence from 15 January 2021 to 14 February 2021, and sell Sekou YANSANÉ external 26 March 2021.'),
  (null, 'Ken Keeley', 'Besiktas', '2021-01-15', '2021-02-14', 1, 'squad_limit', 'Ken Keeley (Besiktas) - one month ban for first offence from 15 January 2021 to 14 February 2021, and sell Liam KITCHING external 26 March 2021.'),
  (null, 'Andy Evans', 'Athletic Club', '2020-11-01', '2021-01-31', 2, 'squad_limit', 'Andy Evans (Athletic Club) - three month ban for second level offence from 1 November 2020 to 31 January 2021, and sell Thijs OOSTING and Iago DOMÍNGUEZ external 21 December and 2 January 2021 respectively.'),
  (null, 'King Kev the Daddy', 'Galatasaray', '2020-12-19', '2021-01-18', 1, 'squad_limit', 'King Kev the Daddy (Galatasaray) - one month ban for first offence from 19 December 2020 to 18 January 2021, and sell Leonardo GODOY external 27 February 2021.'),
  (136, 'Mike Scallotti', 'Standard Liege', '2020-12-07', '2021-01-06', 1, 'squad_limit', 'Mike Scallotti (Standard Liege) - one month ban for first offence from 7 December 2020 to 6 January 2021, and sell Leonid GERCHIKOV external 16 February 2021.'),
  (471, 'Alessandro Ioli', 'Dynamo Kyiv', '2020-11-27', '2020-12-26', 1, 'squad_limit', 'Alessandro Ioli (Dynamo Kyiv) - one month ban for first level offence from 27 November 2020 to 26 December 2020, and sell ISENKO, Pavlo, LAMMENS, Senne, YARMOLYUK, Yehor, STRANNEGARD, Tom, and ALI, Hussein external 5 February 2021.'),
  (133, 'Alex McLean', 'Olympiacos', '2020-11-17', '2020-12-16', 1, 'squad_limit', 'Alex McLean (Olympiacos) - one month ban for first level offence from 17 November 2020 to 16  December 2020, and sell Gabriel LEMOINE external 26 January 2021.'),
  (null, 'Mariano Ratero', 'Boca Juniors', '2020-10-26', '2020-11-25', 1, 'squad_limit', 'Mariano Ratero (Boca Juniors) - one month for first level offence from 26 October to 25 November 2020, and sell Julio BUFFARINI, Julián ÁLVAREZ, Elias PEREYRA and Guido HERRERA external 4 January 2021.'),
  (92, 'Ignazio Barraco', 'Liverpool', '2020-08-25', '2020-11-25', 2, 'squad_limit', 'Ignazio Barraco (Liverpool) three month ban for second level offence from 25 August 2020 to 25 November 2020, and sell Sotiris ALEXANDROPOULOS external 3 November 2020.'),
  (null, 'Gordon ''Gino'' Kinnear', 'Tottenham Hotspur', '2020-10-03', '2020-11-02', 1, 'squad_limit', 'Gordon ''Gino'' Kinnear (Tottenham Hotspur), one month ban for first level offence from 3 October 2020 to 2 November 2020, and sell Passos OTÁVIO external 12 December 2020.'),
  (null, 'Andy Evans', 'Athletic Club', '2020-10-01', '2020-10-31', 1, 'squad_limit', 'Andy Evans (Athletic Club), one month ban for first level offence from 1 October 2020 to 31 October 2020, and sell Alex BLANCO, Callum ROBINSON, and one of Tom HEATON or Ivan SANTINI external 10 December 2020.'),
  (102, 'Feargal Hickey', 'Basel', '2020-08-14', '2020-09-13', 1, 'cancelled_deal', 'Feargal Hickey (Basel) one month for first level offence (cancelling an accepted deal) from 14 August 2020 to 13 September 2020.'),
  (126, 'Ricardo Ferreira', 'Malaga', '2020-08-04', '2020-09-03', 1, 'squad_limit', 'Ricardo Ferreira (Malaga) one month for first level offence from 4 August 2020 to 3 September 2020, and sell Lucas NECUL external 11 October 2020.'),
  (null, 'Alex Borel', 'Chievo VeronaMilan', '2020-07-24', '2020-08-23', 1, 'squad_limit', 'Alex*** Borel (Chievo VeronaMilan) one month for first level offence from 24 July to 23 August 2020, and sell Kévin THÉOPHILE-CATHERINE and Florian LEJEUNE external 3 October 2020.'),
  (92, 'Ignazio Barraco', 'Liverpool', '2020-07-12', '2020-08-11', 1, 'squad_limit', 'Ignazio Barraco (Liverpool) one month for 1st level offence from 12 July 2020 to 11 August 2020, and sell Pedro PELÁGIO external 22 September 2020.'),
  (null, 'Gianluca Ghio', 'Independiente', '2020-06-07', '2020-07-06', 1, 'squad_limit', 'Gianluca Ghio (Independiente) - one month for 1st level offence, from 7 June 2020 to 6 July 2020, and sell Setigui KARAMOKO external 16 August 2020.'),
  (null, 'Steven Logan', 'Bordeaux', '2020-06-05', '2020-07-04', 1, 'squad_limit', 'Steven Logan (Bordeaux) - one month for 1st level offence, from 5 June 2020 to 4 July 2020, and sell Emanuel MAMMANA external 14 August 2020.'),
  (null, 'Roberto Downinho', 'Cruzeiro', '2020-06-04', '2020-07-03', 1, 'squad_limit', 'Roberto Downinho (Cruzeiro) - one month for 1st level offence, from 4 June 2020 to 3 July 2020, and sell Rodrigues HEITOR external 13 August 2020.'),
  (null, 'Nick Wheels', 'LeicesterFenerbahce', '2020-04-28', '2020-05-27', 1, 'squad_limit', 'Nick Wheels (LeicesterFenerbahce) - one month ban for 1st level offence, from 28 April 2020 to 27 May 2020, and sell Shapi SULEYMANOV and Rodrigo CAIO external 8 July 2020.'),
  (116, 'Walter Gogh', 'Atalanta', '2020-04-25', '2020-05-24', 1, 'squad_limit', 'Walter Gogh (Atalanta) - one month ban for 1st level offence, from 25 April 2020 to 24 May 2020, and sell Andrea Petagna and Keito Nakamura external 5 July 2020.'),
  (500, 'Jamie Alldridge', 'Napoli', '2020-04-21', '2020-05-20', 1, 'squad_limit', 'Jamie Alldridge (Napoli) - one month ban for 1st level offence, from 21 April 2020 to 20 May 2020, and sell Nikola Iliev and Adrien Bongiovanni external 1 July 2020.'),
  (513, 'Mark Deadman', 'Celtic', '2020-04-21', '2020-05-20', 1, 'squad_limit', 'Mark Deadman (Celtic) - one month for 1st level offence, from 21 April to 20 May 2020, and sell Emmanuel GYABUAA external 1 July 2020.'),
  (94, 'Stephen Beddows', 'Real MadridSampdoria', '2019-12-13', '2020-03-12', 2, 'squad_limit', 'Stephen Beddows (Real MadridSampdoria) - 3 months for 2nd level offence, from 13 December to 12 March 2020, and sell Nicholas PIERINI external 22 February 2020.'),
  (551, 'Dan Wallace', 'Hertha Berlin', '2019-12-01', '2020-02-28', 2, 'squad_limit', 'Dan Wallace (Hertha Berlin) - 3 months for 2nd offence, from 1 December 2019 to 28 February 2020, and sell Noah OKAFOR external 9 February 2020.'),
  (102, 'Feargal Hickey', 'Olympiacos', '2020-01-14', '2020-02-13', 1, 'squad_limit', 'Feargal Hickey (Olympiacos) - one month for 1st level offence, from 14 January to 13 February 2020, and sell Davor LOVREN external 25 March 2020.'),
  (null, 'Anthony Roach', 'Olympique Lyonnais', '2020-01-09', '2020-02-08', 1, 'squad_limit', 'Anthony Roach (Olympique Lyonnais) - one month for 1st level offence, from 9 January to 8 February 2020, and sell Aritz ADÚRIZ external 19 March 2020 [resigned].'),
  (69, 'Salvatore Zerbo', 'Spartak Moskva', '2019-11-29', '2019-12-28', 1, 'squad_limit', 'Salvatore Zerbo (Spartak Moskva) - 1 month for 1st offence, from 29 November to 28 December 2019, and sell Eros Maddy external 7 February 2020.'),
  (null, 'Bogdan Danciu', 'Lazio', '2019-10-18', '2019-11-17', 1, 'squad_limit', 'Bogdan Danciu (Lazio) - 1 month for 1st offence, from 18 October to 17 November 2019, and sell Mirko MARIĆ external 27 December 2019.'),
  (500, 'Jamie Alldridge', 'Napoli', '2019-09-21', '2019-10-20', 1, 'squad_limit', 'Jamie Alldridge (Napoli) - 1 month for 1st offence, from 21 September to 20 October 2019, and sell Felix AGU external 30 November 2019.'),
  (112, 'Josh McMillan', 'Cruzeiro', '2019-09-19', '2019-10-18', 1, 'squad_limit', 'Josh McMillan (Cruzeiro) - 1 month for 1st offence, from 19 September to 18 October 2019, and sell Felipe MELO external 9 November 2019.'),
  (134, 'Mark Stewart', 'Benfica', '2019-08-21', '2019-09-20', 1, 'squad_limit', 'Mark Stewart (Benfica) - 1 month for 1st offence, from 21 August to 20 September 2019, and sell Danilo BARBOSA and Gedson FERNANDES external 30 October 2019.'),
  (null, 'David The Fox Piero', 'Espanyol', '2019-08-18', '2019-09-17', 1, 'squad_limit', '⚡⚡David The Fox Piero⚡⚡ (Espanyol) - 1 month for 1st offence, from 18 August to 17 September 2019, and sell Neil Etheridge and Aster VRANCKX external 27 October 2019.'),
  (null, 'Geoffrey R', 'Saint-Etienne', '2019-08-12', '2019-09-11', 1, 'squad_limit', 'Geoffrey R (Saint-Etienne) - 1 month for 1st offence, from 12 August to 11 September 2019, and sell Kévin MONNET-PAQUET external 22 October 2019.'),
  (null, 'Mariano Ratero', 'Boca Juniors', '2019-07-27', '2019-08-26', 1, 'squad_limit', 'Mariano Ratero (Boca Juniors) - 1 month for 1st offence, from 27 July to 26 August 2019, and sell Juan CAVALLARO external 5 October 2019.'),
  (138, 'Gursimran Brar', 'Anderlecht', '2019-05-24', '2019-08-23', 2, 'squad_limit', 'Gursimran Brar (Anderlecht) - 3 months for 2nd offence, from 24 May to 23 August 2019, and sell Kingsley MICHAEL external 2 August 2019.'),
  (null, 'Roy Keane', 'Torino', '2019-07-12', '2019-08-11', 1, 'squad_limit', 'Roy Keane (Torino) - 1 month for 1st offence, from 12 July to 11 August 2019, and sell Tanguy COULIBALY external 18 September 2019. [sacked]'),
  (null, 'MaggioGod (EL COMANDANTE)', 'River Plate', '2019-07-02', '2019-08-01', 1, 'squad_limit', 'MaggioGod ( EL COMANDANTE ) (River Plate) - 1 month for 1st offence, from 2 July to 1 August 2019, and return one loanee asap.'),
  (null, 'Niall Taylor', 'Southampton', '2019-07-14', '2019-08-13', 1, 'squad_limit', 'Niall Taylor (Southampton) - 1 month for 1st offence, from 14 July to 13 August 2019, and sell Éric EBIMBE external 22 September 2019 [resigned].'),
  (75, 'Dari Saviano', 'Levante', '2019-05-28', '2019-06-27', 1, 'squad_limit', 'Dari Saviano (Levante) - 1 month for first offence, from 28 May to 27 June 2019, and sell Karamoko DEMBÉLÉ external 6 August 2019.'),
  (null, 'Lana Del Rey', 'Sao Paulo', '2019-05-25', '2019-06-24', 1, 'squad_limit', 'Lana Del Rey (Sao Paulo) - 1 month for first offence, from 25 May to 24 June 2019, and sell Gonçalo RAMOS external 3 August 2019.'),
  (551, 'Dan Wallace', 'Montpellier', '2019-05-11', '2019-06-10', 1, 'squad_limit', 'Dan Wallace (Montpellier) - 1 month for first offence, from 11 May to 10 June 2019, and sell Boubacar FOFANA external 20 July 2019.'),
  (null, 'Greg Bilboa', 'Valencia', '2019-05-04', '2019-06-03', 1, 'squad_limit', 'Greg Bilboa (Valencia) - 1 month for first offence, from 4 May to 3 June 2019, and sell Sigurd GRONLI external 13 July 2019.'),
  (94, 'Stephen Beddows', 'Real Madrid', '2019-03-10', '2019-06-09', 2, 'squad_limit', 'Stephen Beddows (Real Madrid) - 3 months for second offence, from 10 Mar to 9 June 2019.'),
  (138, 'Gursimran Brar', 'Anderlecht', '2019-03-26', '2019-04-25', 1, 'squad_limit', 'Gursimran Brar (Anderlecht) - 1 month for first offence, from 26 Mar to 25 Apr 2019, and sell Erkan EYIBIL external 4 Jun 2019.'),
  (527, 'RJ Alston', 'Everton', '2019-02-17', '2019-05-16', 2, 'squad_limit', 'RJ Alston (Everton) - 3 months for second offence, from 17 Feb to 16 May 2019.'),
  (null, 'Prince Michael William', 'ex-Santos', '2019-04-03', '2019-05-02', 1, 'squad_limit', 'Prince Michael William (ex-Santos) - 1 month for first offence, from 3 Apr to 2 May 2019, and sell Grejohn KYEI external 12 Jun 2019. [resigned]'),
  (77, 'Jay Jones', 'Internazionale', '2019-02-19', '2019-03-18', 1, 'squad_limit', 'Jay Jones (Internazionale) - 1 month for first offence, from 19 Feb to 18 Mar 2019.')

) v(manager_id, manager_name, club_name, starts_on, ends_on, level, kind, note)
left join public.managers manager on manager.id = v.manager_id
on conflict (manager_name, starts_on) do nothing;

create or replace function public.public_transfer_ban_table(p_limit integer default 10)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bans as (
    select history.*,
      coalesce(history.manager_id::text, lower(trim(history.manager_name))) as person,
      coalesce(ban.ends_on, history.ends_on) as effective_end
    from public.transfer_ban_history history
    left join public.club_transfer_bans ban on ban.id = history.ban_id
  ),
  people as (
    select person,
      (array_agg(manager_name order by starts_on desc))[1] as manager,
      count(*) as bans,
      sum(effective_end - starts_on + 1) as days,
      max(effective_end - starts_on + 1) as longest_days,
      max(starts_on) as last_started,
      bool_or(starts_on <= current_date and effective_end >= current_date) as banned_now
    from bans
    group by person
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object('bans', count(*), 'managers', count(distinct person),
      'firstYear', extract(year from min(starts_on)), 'days', sum(effective_end - starts_on + 1)) from bans),
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object('manager', manager, 'bans', bans, 'days', days,
        'longestDays', longest_days, 'lastStarted', last_started, 'bannedNow', banned_now)
        order by bans desc, days desc, last_started desc)
      from (select * from people order by bans desc, days desc, last_started desc limit greatest(1, least(coalesce(p_limit, 10), 50))) top), '[]'::jsonb));
$$;

revoke all on function public.public_transfer_ban_table(integer) from public;
grant execute on function public.public_transfer_ban_table(integer) to anon, authenticated;
