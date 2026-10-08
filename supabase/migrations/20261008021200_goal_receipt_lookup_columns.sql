-- W06-B1: the PL/pgSQL receipt rowtype lookup reads the two remaining metadata columns.
begin;
grant select (created_at, erased_at) on public.request_receipts to chagokchan_rpc;
commit;
