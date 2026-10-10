-- Regression test for the source-id allowlist migration.
-- Covers a current schema (canonical constraint name) and an older schema
-- whose equivalent allowlist check was created with a different name.
begin;

create extension if not exists pgtap with schema extensions;

create temporary table expected_schema_fixture (
  name text not null,
  source_id text,
  constraint pikos_source_id_check
    check (source_id is null or source_id in ('flatpak', 'heroic', 'steam'))
);

create temporary table legacy_schema_fixture (
  name text not null,
  source_id text,
  constraint pikos_source_id_check_legacy_17
    check (source_id is null or source_id in ('flatpak', 'heroic', 'steam', 'lutris')),
  constraint unrelated_name_check check (char_length(name) > 0)
);

create temporary table narrow_source_fixture (
  name text not null,
  source_id text,
  constraint source_id_must_be_steam check (source_id is null or source_id = 'steam')
);

-- Apply the same catalog-based selection used by the migration to both
-- fixtures. The source-id allowlist is replaced, not every CHECK that happens
-- to mention source_id, and unrelated checks must survive.
do $$
declare
  target_table regclass;
  source_id_attnum smallint;
  constraint_row record;
begin
  foreach target_table in array array[
    'pg_temp.expected_schema_fixture'::regclass,
    'pg_temp.legacy_schema_fixture'::regclass,
    'pg_temp.narrow_source_fixture'::regclass
  ]
  loop
    select attnum into source_id_attnum
    from pg_attribute
    where attrelid = target_table
      and attname = 'source_id'
      and not attisdropped;

    for constraint_row in
      select c.conname
      from pg_constraint c
      where c.conrelid = target_table
        and c.contype = 'c'
        and c.conkey = array[source_id_attnum]::smallint[]
        and pg_get_constraintdef(c.oid) ~* 'source_id'
        and pg_get_constraintdef(c.oid) ~* '= any'
        and (select count(distinct matched.source_id)
        from regexp_matches(
          pg_get_constraintdef(c.oid),
          '''(flatpak|heroic|steam|lutris|bottles|itch|apps|epic|whisky|battlenet|gog|prism|legendary|nile)''',
          'gi'
        ) as matched(source_id)) >= 2
    loop
      execute format('alter table %s drop constraint %I', target_table, constraint_row.conname);
    end loop;

    execute format(
      'alter table %s add constraint pikos_source_id_check check (source_id is null or source_id in (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L))',
      target_table,
      'flatpak', 'heroic', 'steam', 'lutris', 'bottles', 'itch', 'apps',
      'epic', 'whisky', 'battlenet', 'gog', 'prism', 'legendary', 'nile'
    );
  end loop;
end
$$;

select plan(10);

select lives_ok(
  $$insert into expected_schema_fixture (name, source_id) values ('Legendary', 'legendary')$$,
  'the expected schema accepts legendary'
);
select lives_ok(
  $$insert into legacy_schema_fixture (name, source_id) values ('Nile', 'nile')$$,
  'a legacy-named allowlist is replaced and accepts nile'
);
select throws_ok(
  $$insert into expected_schema_fixture (name, source_id) values ('Unknown', 'unsupported-launcher')$$,
  '23514', null,
  'the expected schema still rejects unknown source ids'
);
select throws_ok(
  $$insert into legacy_schema_fixture (name, source_id) values ('Unknown', 'unsupported-launcher')$$,
  '23514', null,
  'the legacy schema still rejects unknown source ids'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'pg_temp.expected_schema_fixture'::regclass and conname = 'pikos_source_id_check'),
  'the canonical constraint name is retained on the expected schema'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'pg_temp.legacy_schema_fixture'::regclass and conname = 'pikos_source_id_check'),
  'the canonical constraint name is restored on the legacy schema'
);
select ok(
  not exists (select 1 from pg_constraint where conrelid = 'pg_temp.legacy_schema_fixture'::regclass and conname = 'pikos_source_id_check_legacy_17'),
  'the legacy allowlist constraint is removed'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'pg_temp.legacy_schema_fixture'::regclass and conname = 'unrelated_name_check'),
  'unrelated CHECK constraints are preserved'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'pg_temp.narrow_source_fixture'::regclass and conname = 'source_id_must_be_steam'),
  'a narrow source_id-specific CHECK is not mistaken for the old allowlist'
);
select throws_ok(
  $$insert into legacy_schema_fixture (name, source_id) values ('', 'steam')$$,
  '23514', null,
  'the preserved unrelated CHECK constraint still rejects invalid names'
);

select * from finish();
rollback;
