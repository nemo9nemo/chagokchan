-- W12-B: align future profile defaults with the theme-independent app policy.
-- Existing profiles and previously applied migration files are unchanged.
begin;
alter table public.profiles alter column nickname set default '새로운 사용자';
alter table public.profiles alter column avatar_key set default 'star';
commit;
