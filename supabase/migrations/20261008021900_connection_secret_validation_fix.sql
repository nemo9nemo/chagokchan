-- W06-C1 follow-up: PostgreSQL exposes jsonb_object_keys but not jsonb_object_length.
begin;

create or replace function private.connection_secret_hash(p_secret jsonb) returns text
language plpgsql set search_path = pg_catalog
as $$
declare secret_value text; normalized_code text;
begin
  if p_secret is null or jsonb_typeof(p_secret) <> 'object' then
    raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
  end if;
  if (select count(*) from jsonb_object_keys(p_secret)) <> 1 then
    raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
  end if;
  if p_secret ? 'link_token' and jsonb_typeof(p_secret->'link_token') = 'string' then
    secret_value := p_secret->>'link_token';
    if char_length(secret_value) <> 32 or secret_value !~ '^[A-Za-z0-9_-]{32}$' then
      raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
    end if;
  elsif p_secret ? 'code' and jsonb_typeof(p_secret->'code') = 'string' then
    secret_value := p_secret->>'code';
    if char_length(secret_value) not between 12 and 17 or secret_value !~ '^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z-]{12,17}$' then
      raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
    end if;
    normalized_code := upper(replace(secret_value, '-', ''));
    if char_length(normalized_code) <> 12 or normalized_code !~ '^[0-9A-HJKMNP-TV-Z]{12}$' then
      raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
    end if;
    secret_value := normalized_code;
  else
    raise exception using errcode = 'PT400', message = 'invalid_invite_secret';
  end if;
  return encode(sha256(convert_to(secret_value, 'UTF8')), 'hex');
end $$;

alter function private.connection_secret_hash(jsonb) owner to chagokchan_rpc;
revoke all on function private.connection_secret_hash(jsonb) from public, anon, authenticated, service_role;
commit;
