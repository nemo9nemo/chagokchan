-- Profile removal is part of the account worker's final product-data transaction.
begin;
grant select (user_id), delete on public.profiles to chagokchan_worker;
commit;
