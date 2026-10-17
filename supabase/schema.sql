-- Run this whole file in Supabase > SQL Editor.
-- WARNING: the first three lines delete the old tables (and their data) so the new version installs cleanly.
drop table if exists waitlist cascade;
drop table if exists bookings cascade;
drop table if exists showtimes cascade;
drop table if exists movies cascade;
drop table if exists profiles cascade;
drop view if exists taken_seats;

-- ---------- profiles & roles ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'user' check (role in ('user','admin'))
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- true only when the session passed the Google Authenticator (TOTP) check
create or replace function aal2() returns boolean language sql stable as $$
  select coalesce(auth.jwt()->>'aal','') = 'aal2'
$$;
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select aal2() and exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

-- ---------- core tables ----------
create table movies (
  id bigint generated always as identity primary key,
  title text not null,
  year int,
  rating numeric(3,1) not null check (rating between 0 and 10),
  genres text[] not null,
  duration_min int not null check (duration_min > 0),
  poster_url text not null
);
create table showtimes (
  id bigint generated always as identity primary key,
  movie_id bigint not null references movies(id) on delete cascade,
  starts_at timestamptz not null,
  hall text not null default 'Hall 1',
  price numeric(8,2) not null default 350 check (price > 0)
);
create table bookings (
  id bigint generated always as identity primary key,
  showtime_id bigint not null references showtimes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  seat text not null,
  customer_name text not null,
  customer_email text not null,
  booking_ref text not null,
  created_at timestamptz not null default now(),
  unique (showtime_id, seat)
);
create table waitlist (            -- FIFO queue for sold-out shows
  id bigint generated always as identity primary key,
  showtime_id bigint not null references showtimes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  unique (showtime_id, user_id)
);

-- everyone logged in can see WHICH seats are taken, but not who took them
create view taken_seats as select showtime_id, seat from bookings;
grant select on taken_seats to authenticated;

-- ---------- row level security ----------
alter table profiles enable row level security;
alter table movies enable row level security;
alter table showtimes enable row level security;
alter table bookings enable row level security;
alter table waitlist enable row level security;

create policy "own or admin profile" on profiles for select using (aal2() and (id = auth.uid() or is_admin()));
create policy "admin edits profiles" on profiles for update using (is_admin());

create policy "read movies" on movies for select using (aal2());
create policy "admin writes movies" on movies for all using (is_admin()) with check (is_admin());
create policy "read showtimes" on showtimes for select using (aal2());
create policy "admin writes showtimes" on showtimes for all using (is_admin()) with check (is_admin());

create policy "see own bookings" on bookings for select using (aal2() and (user_id = auth.uid() or is_admin()));
create policy "book for yourself" on bookings for insert with check (aal2() and user_id = auth.uid());
create policy "cancel own or admin" on bookings for delete using (aal2() and (user_id = auth.uid() or is_admin()));

create policy "see own waitlist" on waitlist for select using (aal2() and (user_id = auth.uid() or is_admin()));
create policy "join waitlist" on waitlist for insert with check (aal2() and user_id = auth.uid());
create policy "leave or dequeue" on waitlist for delete using (aal2() and (user_id = auth.uid() or is_admin()));

-- ---------- seed data ----------
insert into movies (title, year, rating, genres, duration_min, poster_url) values
 ('Obsession', 2025, 7.8, '{Horror,Romance}', 109, '/posters/obsession.jpg'),
 ('Spider-Man: Brand New Day', 2026, 8.4, '{Action,Adventure}', 145, '/posters/spider-man.jpg'),
 ('Coyote vs Acme', 2026, 7.5, '{Animation,Adventure}', 103, '/posters/coyote-vs-acme.jpg'),
 ('The Maze Runner', 2014, 6.8, '{Sci-Fi,Thriller}', 113, '/posters/maze-runner.jpg'),
 ('Titanic', 1997, 8.0, '{Drama,Romance}', 194, '/posters/titanic.jpg');

insert into showtimes (movie_id, starts_at, hall, price)
select m.id,
       (date_trunc('day', now()) + (d || ' days')::interval + t.slot)::timestamptz,
       'Hall ' || (1 + (m.id + d) % 3), 350
from movies m
cross join generate_series(0, 4) d
cross join (values (interval '13 hours'), (interval '17 hours'), (interval '20 hours 30 minutes')) as t(slot);

-- AFTER you sign up in the app, make yourself admin (replace the email) and run:
-- update profiles set role = 'admin' where email = 'you@example.com';
