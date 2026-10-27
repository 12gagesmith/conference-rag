"""
Step 1: Create Database Schema
================================
Creates the sentence_embeddings table (with a cleaned-up speaker_name
column), pgvector extension, HNSW vector index, Row Level Security
policies, and the match_sentences() and list_speakers() functions
in your Supabase database.

Usage:
    python scripts/01_create_schema.py

Prerequisites:
    - config.public.json with Supabase URL and anon key
    - config.secret.json with Supabase service key, access token, and project ref
    - Supabase project created
"""

import json
import sys
import time

# Load configuration from both config files
with open('config.public.json', 'r') as f:
    public_config = json.load(f)
with open('config.secret.json', 'r') as f:
    secrets = json.load(f)

SUPABASE_URL = public_config['SUPABASE_URL']
SUPABASE_SERVICE_KEY = secrets['SUPABASE_SERVICE_KEY']
SUPABASE_ACCESS_TOKEN = secrets['SUPABASE_ACCESS_TOKEN']
SUPABASE_PROJECT_REF = secrets['SUPABASE_PROJECT_REF']


def create_schema():
    import requests
    from supabase import create_client

    print("=" * 60)
    print("Creating Database Schema")
    print("=" * 60)

    schema_sql = """
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create sentence_embeddings table
CREATE TABLE IF NOT EXISTS sentence_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    talk_id UUID NOT NULL,
    title TEXT NOT NULL,
    speaker TEXT,
    calling TEXT,
    year INTEGER,
    season TEXT,
    url TEXT,
    sentence_num INTEGER,
    text TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for talk_id grouping
CREATE INDEX IF NOT EXISTS sentence_embeddings_talk_id_idx 
ON sentence_embeddings(talk_id);

-- Create HNSW vector index so match_sentences() doesn't compare against every row
-- (a full scan exceeds the 8s timeout for signed-in users). vector_cosine_ops
-- matches the <=> cosine-distance operator used in match_sentences().
CREATE INDEX IF NOT EXISTS sentence_embeddings_embedding_idx
ON sentence_embeddings USING hnsw (embedding vector_cosine_ops);

-- Clean speaker names for the speaker filter. The scraped speaker field varies for the
-- same person ("By President Henry B. Eyring", "Presented by Elder Henry B. Eyring"),
-- so drop the "By"/"Presented by" prefix and title, and normalize spaces.
-- A generated column fills itself in on every insert, so the import scripts don't change.
ALTER TABLE sentence_embeddings
ADD COLUMN IF NOT EXISTS speaker_name TEXT GENERATED ALWAYS AS (
    trim(regexp_replace(regexp_replace(regexp_replace(
        replace(speaker, chr(160), ' '),                                   -- non-breaking spaces
        '^(presented )?by[[:space:]]+', '', 'i'),                          -- "By " / "Presented by "
        '^(president|elder|sister|brother|bishop)[[:space:]]+', '', 'i'),  -- title
        '[[:space:]]+', ' ', 'g'))
) STORED;

CREATE INDEX IF NOT EXISTS sentence_embeddings_speaker_name_idx
ON sentence_embeddings(speaker_name);

-- Enable Row Level Security
ALTER TABLE sentence_embeddings ENABLE ROW LEVEL SECURITY;

-- RLS policy: authenticated users can read
DROP POLICY IF EXISTS "Allow authenticated users to read" ON sentence_embeddings;
CREATE POLICY "Allow authenticated users to read"
ON sentence_embeddings FOR SELECT
TO authenticated
USING (true);

-- ============================================
-- Page Views table (PUBLIC access for RLS demo)
-- ============================================
-- This table intentionally has PUBLIC policies so students can
-- contrast it with sentence_embeddings (auth-only).

CREATE TABLE IF NOT EXISTS page_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    visited_at TIMESTAMPTZ DEFAULT NOW(),
    page_url TEXT,
    user_agent TEXT
);

ALTER TABLE page_views ENABLE ROW LEVEL SECURITY;

-- Anyone (including unauthenticated visitors) can insert page views
DROP POLICY IF EXISTS "Allow public inserts" ON page_views;
CREATE POLICY "Allow public inserts"
ON page_views FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Anyone can read page views (for the counter)
DROP POLICY IF EXISTS "Allow public reads" ON page_views;
CREATE POLICY "Allow public reads"
ON page_views FOR SELECT
TO anon, authenticated
USING (true);

-- Create function for similarity search, optionally limited to one speaker
-- (filter_speaker matches speaker_name). Drop the older two-argument version first:
-- it didn't return url, and its return type can't be changed in place.
DROP FUNCTION IF EXISTS match_sentences(vector, integer);

CREATE OR REPLACE FUNCTION match_sentences(
  query_embedding vector(1536),
  match_count int DEFAULT 20,
  filter_speaker text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  talk_id uuid,
  title text,
  speaker text,
  url text,
  text text,
  similarity float
)
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  IF filter_speaker IS NULL THEN
    -- All speakers: the HNSW index finds the closest sentences quickly
    RETURN QUERY
    SELECT se.id, se.talk_id, se.title, se.speaker, se.url, se.text,
           1 - (se.embedding <=> query_embedding) AS similarity
    FROM sentence_embeddings se
    ORDER BY se.embedding <=> query_embedding
    LIMIT match_count;
  ELSE
    -- One speaker: compare against all of their sentences (at most ~1,600) for exact
    -- results. Sorting by similarity instead of distance keeps the planner off the HNSW
    -- index, which only returns ~40 candidates before the speaker filter is applied.
    RETURN QUERY
    SELECT se.id, se.talk_id, se.title, se.speaker, se.url, se.text,
           1 - (se.embedding <=> query_embedding) AS similarity
    FROM sentence_embeddings se
    WHERE se.speaker_name = filter_speaker
    ORDER BY 1 - (se.embedding <=> query_embedding) DESC
    LIMIT match_count;
  END IF;
END;
$$;

-- Speaker names with talk counts, for the speaker filter's suggestions
CREATE OR REPLACE FUNCTION list_speakers()
RETURNS TABLE (
  speaker_name text,
  talk_count bigint
)
LANGUAGE sql STABLE
AS $$
  SELECT se.speaker_name, count(DISTINCT se.talk_id)
  FROM sentence_embeddings se
  GROUP BY se.speaker_name
  ORDER BY se.speaker_name;
$$;
"""

    url = f"https://api.supabase.com/v1/projects/{SUPABASE_PROJECT_REF}/database/query"
    headers = {
        "Authorization": f"Bearer {SUPABASE_ACCESS_TOKEN}",
        "Content-Type": "application/json"
    }

    resp = requests.post(url, headers=headers, json={"query": schema_sql})
    if resp.status_code in (200, 201):
        print("✅ Database schema created successfully!")
    else:
        print(f"❌ Schema creation failed: {resp.status_code}")
        print(resp.text[:500])
        return False

    # Verify table exists via PostgREST
    client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    for attempt in range(5):
        try:
            result = client.table('sentence_embeddings').select('id', count='exact').limit(1).execute()
            print(f"✅ Table verified. Current rows: {result.count or 0}")
            return True
        except Exception:
            if attempt < 4:
                print(f"   Waiting for schema cache to refresh... ({attempt + 1}/5)")
                time.sleep(3)
            else:
                print("⚠️  Table created but PostgREST cache hasn't refreshed yet.")
                print("   This is normal — it should be ready by import time.")
                return True


if __name__ == '__main__':
    if not create_schema():
        sys.exit(1)
    print("\n✅ Schema ready! Next: python scripts/02_scrape_data.py")
