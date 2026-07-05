create table if not exists tournament_round_dates (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  bracket text not null check (bracket in ('Cup', 'Shield')),
  round text not null,
  leg1_date date not null,
  leg2_date date,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  unique (tournament_id, bracket, round)
);

create index if not exists tournament_round_dates_tournament_idx
  on tournament_round_dates (tournament_id, bracket, round);
