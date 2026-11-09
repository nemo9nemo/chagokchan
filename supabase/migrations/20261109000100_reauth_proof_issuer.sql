-- W12-D1: only the server's signed, scoped proof can mint a session-bound grant.
-- Actual verification keys are provisioned separately; this migration contains none.
begin;

create role chagokchan_reauth_issuer nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema public, private, extensions to chagokchan_reauth_issuer;
grant execute on function private.require_actor(), private.session_account_id(), private.current_session_id() to chagokchan_reauth_issuer;

create table private.reauth_proof_keys (
  key_id text primary key check (key_id ~ '^[0-9a-f]{64}$'),
  key_bytes bytea not null check (octet_length(key_bytes) = 32),
  enabled boolean not null default true
);
alter table private.reauth_proof_keys enable row level security;
alter table private.reauth_proof_keys force row level security;
revoke all on private.reauth_proof_keys from public, anon, authenticated, service_role, chagokchan_rpc, chagokchan_worker, chagokchan_reauth_issuer;
grant select (key_id, key_bytes, enabled) on private.reauth_proof_keys to chagokchan_reauth_issuer;
create policy reauth_key_read on private.reauth_proof_keys for select to chagokchan_reauth_issuer using (enabled);

grant select (id, user_id, session_id, scope, verified_at, expires_at, consumed_at),
  insert (id, user_id, session_id, scope, verified_at, expires_at)
  on public.reauth_grants to chagokchan_reauth_issuer;
create policy reauth_issuer_select on public.reauth_grants for select to chagokchan_reauth_issuer
  using (user_id = private.session_account_id() and session_id = private.current_session_id());
create policy reauth_issuer_insert on public.reauth_grants for insert to chagokchan_reauth_issuer
  with check (user_id = private.require_actor() and session_id = private.current_session_id()
    and scope = 'account.delete' and consumed_at is null and verified_at <= clock_timestamp()
    and expires_at > clock_timestamp() and expires_at <= verified_at + interval '10 minutes');

grant create on schema public to chagokchan_reauth_issuer;
grant chagokchan_reauth_issuer to postgres with inherit false, set true;
set local role chagokchan_reauth_issuer;

create function public.issue_reauth_grant(p_payload text, p_signature text) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $$
declare actor uuid; session_uuid uuid; proof jsonb; grant_uuid uuid; proof_user uuid; proof_session uuid;
  issued bigint; deadline bigint; now_at timestamptz := clock_timestamp();
  key_material bytea; provided bytea; expected bytea; difference integer := 0; idx integer;
  decoded bytea; existing record; verified_at_value timestamptz; expires_at_value timestamptz;
begin
  actor := private.require_actor();
  session_uuid := private.current_session_id();
  if p_payload is null or char_length(p_payload) not between 64 and 2000 or
     p_payload !~ '^[A-Za-z0-9_-]+$' or p_signature is null or p_signature !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = 'PT400', message = 'invalid_reauth_proof';
  end if;
  begin
    decoded := decode(translate(p_payload, '-_', '+/') || repeat('=', (4 - char_length(p_payload) % 4) % 4), 'base64');
    if translate(rtrim(replace(encode(decoded, 'base64'), E'\n', ''), '='), '+/', '-_') <> p_payload then
      raise exception using errcode = '22023';
    end if;
    proof := convert_from(decoded, 'UTF8')::jsonb;
    provided := decode(translate(p_signature, '-_', '+/') || '=', 'base64');
    if octet_length(provided) <> 32 or translate(rtrim(replace(encode(provided, 'base64'), E'\n', ''), '='), '+/', '-_') <> p_signature then
      raise exception using errcode = '22023';
    end if;
  exception when invalid_parameter_value or character_not_in_repertoire or invalid_text_representation then
    raise exception using errcode = 'PT400', message = 'invalid_reauth_proof';
  end;
  if jsonb_typeof(proof) <> 'object' then raise exception using errcode = 'PT400', message = 'invalid_reauth_proof'; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(proof) k) is distinct from
       array['exp','iat','kid','nonce','provider','scope','sid','sub','v']::text[] or
     proof->'v' is distinct from '1'::jsonb or proof->>'provider' is distinct from 'google' or
     proof->>'scope' is distinct from 'account.delete' or coalesce(proof->>'kid','') !~ '^[0-9a-f]{64}$' or
     jsonb_typeof(proof->'iat') <> 'number' or jsonb_typeof(proof->'exp') <> 'number' or
     coalesce(proof->>'iat','') !~ '^[0-9]{1,16}$' or coalesce(proof->>'exp','') !~ '^[0-9]{1,16}$' then
    raise exception using errcode = 'PT400', message = 'invalid_reauth_proof';
  end if;
  select k.key_bytes into key_material from private.reauth_proof_keys k where k.key_id = proof->>'kid' and k.enabled;
  if key_material is null then raise exception using errcode = 'PT503', message = 'reauth_key_unavailable'; end if;
  expected := extensions.hmac(convert_to(p_payload, 'UTF8'), key_material, 'sha256');
  for idx in 0..31 loop difference := difference | (get_byte(expected, idx) # get_byte(provided, idx)); end loop;
  if difference <> 0 then raise exception using errcode = 'PT403', message = 'reauth_required'; end if;
  begin
    grant_uuid := (proof->>'nonce')::uuid;
    proof_user := (proof->>'sub')::uuid;
    proof_session := (proof->>'sid')::uuid;
    issued := (proof->>'iat')::bigint;
    deadline := (proof->>'exp')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'PT400', message = 'invalid_reauth_proof';
  end;
  if grant_uuid is null or proof_user is distinct from actor or proof_session is distinct from session_uuid or
     deadline - issued <> 600 or issued > floor(extract(epoch from now_at)) + 30 or deadline <= extract(epoch from now_at) then
    raise exception using errcode = 'PT403', message = 'reauth_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('reauth-grant:' || grant_uuid::text, 0));
  select g.id, g.user_id, g.session_id, g.scope, g.expires_at, g.consumed_at into existing
    from public.reauth_grants g where g.id = grant_uuid;
  if found then
    if existing.user_id is distinct from actor or existing.session_id is distinct from session_uuid or
       existing.scope <> 'account.delete' or existing.consumed_at is not null or existing.expires_at <= now_at then
      raise exception using errcode = 'PT403', message = 'reauth_required';
    end if;
    return jsonb_build_object('grant_id', existing.id, 'expires_at', existing.expires_at);
  end if;
  verified_at_value := least(to_timestamp(issued), now_at);
  expires_at_value := least(to_timestamp(deadline), verified_at_value + interval '10 minutes');
  insert into public.reauth_grants(id, user_id, session_id, scope, verified_at, expires_at)
    values (grant_uuid, actor, session_uuid, 'account.delete', verified_at_value, expires_at_value);
  return jsonb_build_object('grant_id', grant_uuid, 'expires_at', expires_at_value);
end $$;
revoke all on function public.issue_reauth_grant(text, text) from public, anon, authenticated, service_role;
grant execute on function public.issue_reauth_grant(text, text) to authenticated;

reset role;
revoke create on schema public from chagokchan_reauth_issuer;
revoke chagokchan_reauth_issuer from postgres;
notify pgrst, 'reload schema';
commit;
