create extension if not exists vector;

create table if not exists library_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  source_type text not null,
  source_ref text not null,
  content_hash text not null,
  raw_text text not null,
  metadata jsonb not null default '{}'::jsonb,
  ingested_at timestamptz not null default now(),
  unique (source_ref, content_hash)
);

create table if not exists library_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references library_documents(id) on delete cascade,
  position integer not null,
  section_path text,
  content text not null,
  content_tsvector tsvector generated always as
    (to_tsvector('english', content)) stored,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists library_chunks_tsv_idx
  on library_chunks using gin (content_tsvector);
create index if not exists library_chunks_embedding_idx
  on library_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists library_chunks_document_position_idx
  on library_chunks (document_id, position);

create table if not exists library_tree_nodes (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references library_documents(id) on delete cascade,
  parent_id uuid references library_tree_nodes(id) on delete cascade,
  depth integer not null,
  position integer not null,
  title text not null,
  content_full text not null,
  content_summary text not null,
  path_titles text[] not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists library_tree_nodes_doc_parent_idx
  on library_tree_nodes (document_id, parent_id, position);
create unique index if not exists library_tree_nodes_doc_path_idx
  on library_tree_nodes (document_id, path_titles);

create table if not exists library_pageindex_summary_cache (
  content_hash text primary key,
  model text not null,
  summary text not null,
  cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists library_pageindex_nav_cache (
  query_hash text not null,
  tree_revision text not null,
  result_node_ids uuid[] not null default '{}',
  trace jsonb not null default '{}'::jsonb,
  cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now(),
  primary key (query_hash, tree_revision)
);

create table if not exists library_eval_queries (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  ideal_answer text,
  relevant_chunk_ids uuid[] default '{}',
  relevant_node_ids uuid[] default '{}',
  source text not null check (source in ('synthetic', 'human')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists library_eval_runs (
  id uuid primary key default gen_random_uuid(),
  pipeline text not null check (pipeline in ('hybrid', 'page_index')),
  config jsonb not null default '{}'::jsonb,
  dataset_size integer not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb
);

create table if not exists library_eval_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references library_eval_runs(id) on delete cascade,
  query_id uuid not null references library_eval_queries(id) on delete cascade,
  retrieved jsonb not null,
  latency_ms integer not null,
  cost_usd numeric(10,6) not null default 0,
  recall_at_5 numeric(5,4),
  recall_at_8 numeric(5,4),
  mrr numeric(5,4),
  ndcg_at_10 numeric(5,4),
  judge_score numeric(3,2),
  judge_reasoning text,
  created_at timestamptz not null default now()
);
create index if not exists library_eval_results_run_idx
  on library_eval_results (run_id);

create or replace function hybrid_bm25_search(query_text text, match_count integer default 50)
returns table (
  id uuid,
  document_id uuid,
  content text,
  section_path text,
  metadata jsonb,
  score double precision
)
language sql
stable
as $$
  with query as (
    select websearch_to_tsquery('english', coalesce(query_text, '')) as q
  )
  select c.id,
         c.document_id,
         c.content,
         c.section_path,
         c.metadata,
         ts_rank_cd(c.content_tsvector, query.q)::double precision as score
  from library_chunks c, query
  where query.q <> ''::tsquery
    and c.content_tsvector @@ query.q
  order by score desc, c.position asc
  limit greatest(match_count, 1);
$$;

create or replace function hybrid_vector_search(query_embedding vector(1536), match_count integer default 50)
returns table (
  id uuid,
  document_id uuid,
  content text,
  section_path text,
  metadata jsonb,
  score double precision
)
language sql
stable
as $$
  select c.id,
         c.document_id,
         c.content,
         c.section_path,
         c.metadata,
         (1 - (c.embedding <=> query_embedding))::double precision as score
  from library_chunks c
  where c.embedding is not null
  order by c.embedding <=> query_embedding, c.position asc
  limit greatest(match_count, 1);
$$;
