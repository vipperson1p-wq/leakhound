create table public.profiles (id uuid primary key, name text);
create table if not exists messages (id serial, user_id uuid, body text);
create table "notes" (id serial);
alter table profiles enable row level security;
alter table notes enable row level security;
create policy "anyone can read" on profiles for select using (true);
create policy "anyone can edit" on notes using (true);
create policy "own notes" on notes for select using (auth.uid() = user_id);
