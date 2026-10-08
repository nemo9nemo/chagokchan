-- Shape/integrity and initial deny-all checks. No manufactured Auth JWTs.
-- Managed fixture users must first be prepared through the local Admin API.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(51);

create temporary table test_ids(key text primary key, value uuid not null);
insert into test_ids(key, value)
select raw_app_meta_data->>'fixture_actor', id from auth.users
where raw_app_meta_data->>'fixture_project' = 'chagokchan' and raw_app_meta_data->>'local_fixture' = 'true';
insert into test_ids(key, value) select key, gen_random_uuid() from unnest(array[
  'goal','empty_goal','personal','shared','personal_bunch','shared_bunch','self_receipt','peer_receipt','self_praise','peer_praise',
  'connection','invite_one','invite_two','request_one','request_two','notification','request_key','rate','deletion','erased_subject',
  'cross_bunch_receipt','cross_bunch_praise','cross_recipient_receipt','cross_recipient_praise'
]) as keys(key);
create function pg_temp.test_id(name text) returns uuid language sql stable
as $$ select value from pg_temp.test_ids where key = name $$;

-- 1..5: infrastructure and fixture preconditions.
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'), 18::bigint, '18 app-owned tables; managed Auth remains separate');
select ok((select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'), 'all app tables force RLS');
select ok((select bool_and(not has_table_privilege(role, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join unnest(array['anon','authenticated','service_role']) as roles(role) where n.nspname = 'public' and c.relkind = 'r'), 'API roles have no direct table privileges');
select ok((select bool_and(not has_schema_privilege(role, 'private', 'USAGE')) from unnest(array['anon','authenticated','service_role']) as roles(role)), 'private helper schema is inaccessible to API roles');
select is((select count(*) from test_ids where key in ('A','B','C')), 3::bigint, 'three marked synthetic Auth identities exist');

-- 6: build a coherent personal/shared fixture within this rollback transaction.
select lives_ok($test$
  insert into public.goals(id, owner_user_id, title) values (pg_temp.test_id('goal'), pg_temp.test_id('A'), 'DB transaction test');
  insert into public.boards(id, goal_id, owner_user_id, kind) values
    (pg_temp.test_id('personal'), pg_temp.test_id('goal'), pg_temp.test_id('A'), 'personal'),
    (pg_temp.test_id('shared'), pg_temp.test_id('goal'), pg_temp.test_id('A'), 'shared');
  insert into public.shared_board_profiles(board_id, public_title) values (pg_temp.test_id('shared'), 'Shared test display');
  insert into public.bunches(id, board_id, cycle_no, target_count) values
    (pg_temp.test_id('personal_bunch'), pg_temp.test_id('personal'), 1, 20),
    (pg_temp.test_id('shared_bunch'), pg_temp.test_id('shared'), 1, 20);
  update public.boards set current_bunch_id = pg_temp.test_id('personal_bunch') where id = pg_temp.test_id('personal');
  insert into public.request_receipts(id, actor_user_id, operation, request_key, input_hash, result_kind, result_id) values
    (pg_temp.test_id('self_receipt'), pg_temp.test_id('A'), 'createPraise', pg_temp.test_id('request_key'), repeat('a',64), 'praise', pg_temp.test_id('self_praise')),
    (pg_temp.test_id('peer_receipt'), pg_temp.test_id('B'), 'createPraise', gen_random_uuid(), repeat('b',64), 'praise', pg_temp.test_id('peer_praise'));
  insert into public.praises(id, board_id, bunch_id, actor_user_id, recipient_user_id, request_receipt_id, source, message) values
    (pg_temp.test_id('self_praise'), pg_temp.test_id('personal'), pg_temp.test_id('personal_bunch'), pg_temp.test_id('A'), pg_temp.test_id('A'), pg_temp.test_id('self_receipt'), 'self', 'A test message'),
    (pg_temp.test_id('peer_praise'), pg_temp.test_id('shared'), pg_temp.test_id('shared_bunch'), pg_temp.test_id('B'), pg_temp.test_id('A'), pg_temp.test_id('peer_receipt'), 'peer', 'B test message');
$test$, 'valid owner, board, bunch and receipt references can be stored');

-- 7..12: relational mistakes and accidental deletion are rejected by PostgreSQL.
insert into public.goals(id,owner_user_id,title) values (pg_temp.test_id('empty_goal'),pg_temp.test_id('A'),'Owner FK test without a duplicate board');
select throws_ok($$insert into public.boards(goal_id, owner_user_id, kind) values (pg_temp.test_id('empty_goal'), pg_temp.test_id('B'), 'personal')$$, '23503', null, 'board cannot attach another owner to A goal');
select throws_ok($$insert into public.boards(goal_id, owner_user_id, kind) values (pg_temp.test_id('goal'), pg_temp.test_id('A'), 'personal')$$, '23505', null, 'only one personal board per goal');
select throws_ok($$update public.boards set current_bunch_id = pg_temp.test_id('shared_bunch') where id = pg_temp.test_id('personal')$$, '23503', null, 'current bunch must belong to the same board');
insert into public.request_receipts(id,actor_user_id,operation,request_key,input_hash,result_kind,result_id) values
  (pg_temp.test_id('cross_bunch_receipt'),pg_temp.test_id('A'),'createPraise',gen_random_uuid(),repeat('5',64),'praise',pg_temp.test_id('cross_bunch_praise')),
  (pg_temp.test_id('cross_recipient_receipt'),pg_temp.test_id('B'),'createPraise',gen_random_uuid(),repeat('6',64),'praise',pg_temp.test_id('cross_recipient_praise'));
select throws_ok($$insert into public.praises(id,board_id,bunch_id,actor_user_id,recipient_user_id,request_receipt_id,source) values(pg_temp.test_id('cross_bunch_praise'),pg_temp.test_id('personal'),pg_temp.test_id('shared_bunch'),pg_temp.test_id('A'),pg_temp.test_id('A'),pg_temp.test_id('cross_bunch_receipt'),'self')$$, '23503', null, 'praise cannot reference another board bunch');
select throws_ok($$insert into public.praises(id,board_id,bunch_id,actor_user_id,recipient_user_id,request_receipt_id,source) values(pg_temp.test_id('cross_recipient_praise'),pg_temp.test_id('shared'),pg_temp.test_id('shared_bunch'),pg_temp.test_id('B'),pg_temp.test_id('C'),pg_temp.test_id('cross_recipient_receipt'),'peer')$$, '23503', null, 'recipient must own the praise board');
select throws_ok($$delete from public.request_receipts where id = pg_temp.test_id('self_receipt')$$, '23503', null, 'receipt deletion cannot cascade into a retained praise');

-- 13..18: source, author erasure and cancellation cannot leave inconsistent bodies.
select throws_ok($$update public.praises set actor_user_id = null where id = pg_temp.test_id('peer_praise')$$, '23514', null, 'anonymous author requires completed erasure');
select throws_ok($$update public.praises set actor_user_id = pg_temp.test_id('B') where id = pg_temp.test_id('self_praise')$$, '23514', null, 'self praise cannot be attributed to a peer');
select throws_ok($$update public.praises set occurred_on = current_date where id = pg_temp.test_id('peer_praise')$$, '23514', null, 'peer praise has no practice date input');
select throws_ok($$update public.praises set cancelled_at = now() where id = pg_temp.test_id('self_praise')$$, '23514', null, 'cancel must erase body and practice date atomically');
select throws_ok($$update public.praises set actor_user_id = null, author_erased_at = now() where id = pg_temp.test_id('peer_praise')$$, '23514', null, 'author erasure cannot retain message content');
select lives_ok($$update public.praises set actor_user_id = null, author_erased_at = now(), message = null, occurred_on = null where id = pg_temp.test_id('peer_praise'); update public.request_receipts set actor_user_id = null, input_hash = null, erased_at = now() where id = pg_temp.test_id('peer_receipt')$$, 'author removal retains the peer event and its erased receipt stub');

-- 19..26: Unicode length, bounded progress and soft-deletion shape.
select lives_ok($$insert into public.goals(owner_user_id,title) values (pg_temp.test_id('A'),repeat('😀',80))$$, '80 Unicode code points are accepted regardless of UTF-16 width');
select throws_ok($$insert into public.goals(owner_user_id,title) values (pg_temp.test_id('A'),repeat('😀',81))$$, '23514', null, '81 code points exceed the title limit');
select throws_ok($$update public.goals set private_description = repeat('x',1001) where id = pg_temp.test_id('goal')$$, '23514', null, 'long private descriptions are rejected');
select throws_ok($$update public.boards set next_target_count = 0 where id = pg_temp.test_id('personal')$$, '23514', null, 'target count cannot be zero');
select throws_ok($$update public.bunches set valid_count = 21 where id = pg_temp.test_id('personal_bunch')$$, '23514', null, 'progress cannot exceed the frozen target');
select throws_ok($$update public.bunches set progress_state = 'complete', completed_at = now() where id = pg_temp.test_id('personal_bunch')$$, '23514', null, 'completion cannot contradict progress count');
select throws_ok($$insert into public.bunches(board_id,cycle_no,target_count) values (pg_temp.test_id('personal'),1,20)$$, '23505', null, 'cycle number cannot be reused on the same board');
select throws_ok($$update public.goals set status = 'deleted', deleted_at = now() where id = pg_temp.test_id('goal')$$, '23514', null, 'deleted goals require a purge deadline');

-- 27..35: normalized relationships and single-use request/grant keys.
select throws_ok($$insert into public.connections(user_low_id,user_high_id) values (greatest(pg_temp.test_id('A'),pg_temp.test_id('C')),least(pg_temp.test_id('A'),pg_temp.test_id('C')))$$, '23514', null, 'reverse relationship pair is rejected');
select throws_ok($$insert into public.connections(user_low_id,user_high_id) values (pg_temp.test_id('A'),pg_temp.test_id('A'))$$, '23514', null, 'self connection is rejected');
insert into public.connections(id,user_low_id,user_high_id,status) values (pg_temp.test_id('connection'),least(pg_temp.test_id('A'),pg_temp.test_id('C')),greatest(pg_temp.test_id('A'),pg_temp.test_id('C')),'inactive');
insert into public.connection_invites(id,inviter_user_id,link_hash,code_hash,expires_at) values
  (pg_temp.test_id('invite_one'),pg_temp.test_id('A'),repeat('c',64),repeat('d',64),now()+interval '1 day'),
  (pg_temp.test_id('invite_two'),pg_temp.test_id('C'),repeat('e',64),repeat('f',64),now()+interval '1 day');
select throws_ok($$insert into public.connection_invites(inviter_user_id,link_hash,code_hash,expires_at) values (pg_temp.test_id('A'),'raw-secret',repeat('1',64),now()+interval '1 day')$$, '23514', null, 'raw invite secret is not a SHA-256 hash');
select throws_ok($$insert into public.connection_invites(inviter_user_id,link_hash,expires_at) values (pg_temp.test_id('A'),repeat('2',64),now()+interval '1 day')$$, '23502', null, 'link and code hashes are both required');
insert into public.connection_requests(id,connection_id,invite_id,requester_user_id,approver_user_id,expires_at) values
  (pg_temp.test_id('request_one'),pg_temp.test_id('connection'),pg_temp.test_id('invite_one'),pg_temp.test_id('C'),pg_temp.test_id('A'),now()+interval '2 days');
select throws_ok($$insert into public.connection_requests(connection_id,invite_id,requester_user_id,approver_user_id,expires_at) values (pg_temp.test_id('connection'),pg_temp.test_id('invite_two'),pg_temp.test_id('A'),pg_temp.test_id('C'),now()+interval '2 days')$$, '23505', null, 'opposite direction cannot create a second pending request');
update public.connection_requests set status='rejected',resolved_at=now() where id=pg_temp.test_id('request_one');
select throws_ok($$insert into public.connection_requests(connection_id,invite_id,requester_user_id,approver_user_id,expires_at) values (pg_temp.test_id('connection'),pg_temp.test_id('invite_one'),pg_temp.test_id('C'),pg_temp.test_id('A'),now()+interval '2 days')$$, '23505', null, 'a consumed invite cannot create another request');
select throws_ok($$insert into public.board_members(board_id,user_id,connection_id,connection_generation,granted_by_user_id) values (pg_temp.test_id('shared'),pg_temp.test_id('C'),pg_temp.test_id('connection'),1,pg_temp.test_id('B'))$$, '23503', null, 'only the board owner can be the grant issuer');
insert into public.board_members(board_id,user_id,connection_id,connection_generation,granted_by_user_id) values (pg_temp.test_id('shared'),pg_temp.test_id('C'),pg_temp.test_id('connection'),1,pg_temp.test_id('A'));
select lives_ok($$update public.connections set generation = 2, status = 'active', connected_at = now() where id = pg_temp.test_id('connection')$$, 'reconnection can advance without rewriting historical grant generation');
select throws_ok($$insert into public.board_members(board_id,user_id,connection_id,connection_generation,granted_by_user_id) values (pg_temp.test_id('personal'),pg_temp.test_id('A'),pg_temp.test_id('connection'),2,pg_temp.test_id('A'))$$, '23514', null, 'owner is not their own contributor');

-- 36..43: typed news, idempotency, erasure stubs and quota windows.
select throws_ok($$insert into public.notifications(recipient_user_id,type,dedupe_key,bunch_id) values (pg_temp.test_id('A'),'praise_received','bad-target',pg_temp.test_id('shared_bunch'))$$, '23514', null, 'notification type must match exactly one target');
insert into public.notifications(id,recipient_user_id,type,dedupe_key,bunch_id) values (pg_temp.test_id('notification'),pg_temp.test_id('A'),'bunch_completed','completed:test',pg_temp.test_id('personal_bunch'));
select throws_ok($$insert into public.notifications(recipient_user_id,type,dedupe_key,bunch_id) values (pg_temp.test_id('A'),'bunch_completed','completed:test',pg_temp.test_id('personal_bunch'))$$, '23505', null, 'duplicate notification is rejected');
select throws_ok($$insert into public.request_receipts(actor_user_id,operation,request_key,input_hash,result_kind,result_id) values (pg_temp.test_id('A'),'createPraise',pg_temp.test_id('request_key'),repeat('9',64),'praise',gen_random_uuid())$$, '23505', null, 'one operation and request key has one result');
select lives_ok($$update public.request_receipts set input_hash = null, erased_at = now() where id = pg_temp.test_id('self_receipt')$$, 'erased input can retain actor and key to prevent result recreation');
select throws_ok($$insert into public.request_receipts(actor_user_id,operation,request_key,input_hash,result_kind,result_id) values (pg_temp.test_id('A'),'createPraise',pg_temp.test_id('request_key'),repeat('8',64),'praise',gen_random_uuid())$$, '23505', null, 'erased result stub still forbids reuse of its original key');
select throws_ok($$insert into public.rate_usage(actor_user_id,scope_key,window_start,window_end) values (pg_temp.test_id('A'),'write',now(),now())$$, '23514', null, 'zero-length quota window is rejected');
insert into public.rate_usage(id,actor_user_id,scope_key,window_start,window_end) values (pg_temp.test_id('rate'),pg_temp.test_id('A'),'write',now(),now()+interval '1 minute');
select throws_ok($$insert into public.rate_usage(actor_user_id,scope_key,window_start,window_end) values (pg_temp.test_id('A'),'write',now(),now()+interval '1 minute')$$, '23505', null, 'quota bucket cannot be duplicated');
insert into public.account_deletion_requests(id,user_id,subject_auth_user_id) values (pg_temp.test_id('deletion'),pg_temp.test_id('A'),pg_temp.test_id('A'));
select throws_ok($$insert into public.account_deletion_requests(user_id,subject_auth_user_id,status) values (pg_temp.test_id('A'),pg_temp.test_id('A'),'failed')$$, '23505', null, 'failed deletion must reuse the existing open job');

-- 44..46: deletion state and retained author event checks.
select lives_ok($$insert into public.account_deletion_requests(subject_auth_user_id,status,started_at,completed_at,checkpoint) values (pg_temp.test_id('erased_subject'),'completed',now(),now(),'auth_removed')$$, 'deletion result can outlive the managed Auth identity');
select ok(exists(select 1 from public.praises where id=pg_temp.test_id('peer_praise') and actor_user_id is null and message is null and author_erased_at is not null and cancelled_at is null and excluded_at is null), 'erased peer event remains valid and anonymous');
select ok((select bool_and(c.confdeltype in ('a','r')) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and c.contype='f'), 'app foreign keys require deliberate cleanup instead of cascading deletion');

-- 47..51: actual role execution, then simulate an accidental table grant.
set local role anon;
select throws_ok('select * from public.goals', '42501', null, 'anonymous direct read is denied');
reset role;
set local role authenticated;
select throws_ok('update public.goals set title = ''direct write''', '42501', null, 'authenticated direct write is denied');
reset role;
set local role service_role;
select throws_ok('select * from public.goals', '42501', null, 'service role has no ordinary app table read privilege');
reset role;
grant select, insert on public.goals to authenticated;
set local role authenticated;
select is((select count(*) from public.goals), 0::bigint, 'deny-all RLS still hides rows after an accidental SELECT grant');
select throws_ok('insert into public.goals(owner_user_id,title) values (gen_random_uuid(),''direct insert'')', '42501', null, 'deny-all RLS still rejects writes after an accidental INSERT grant');
reset role;

select * from finish();
rollback;
