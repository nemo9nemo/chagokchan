-- Owner praise projections include the hidden timestamp; contributors still receive a restricted JSON shape.
begin;
grant select (hidden_at) on public.praises to chagokchan_rpc;
commit;
