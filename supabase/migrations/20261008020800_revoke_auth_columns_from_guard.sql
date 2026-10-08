-- W06-A: the app-state guard uses product metadata only; Auth reads stay isolated.
begin;
revoke select (id, user_id, created_at, refreshed_at, not_after) on auth.sessions from chagokchan_guard;
revoke select (id, banned_until, deleted_at, is_anonymous) on auth.users from chagokchan_guard;
commit;
