# Speaker filter

_Status: approved · 2026-10-26_

## Goal
Let a signed-in user pick one conference speaker and have keyword, semantic, and RAG search look only at that speaker's talks.

## Must have
- One shared **Speaker** box above the three search panels, with type-to-search suggestions (e.g. typing "eyr" suggests "Henry B. Eyring (21 talks)") and a × button to clear it.
- Empty box means **All speakers**, which is how search works today.
- Each person appears once, under a clean name. `By President Henry B. Eyring`, `Presented by Elder Henry B. Eyring`, and so on all become **Henry B. Eyring** (197 raw values become 177 people).
- **Keyword:** only matching sentences from that speaker.
- **Semantic:** that speaker's 20 closest sentences, even if they're only loosely related. The similarity badges show how close they are.
- **RAG:** source talks come only from that speaker. If they never addressed the question, the answer says so, as the prompt already instructs.
- A line above the results shows which speaker a search was limited to, so a filtered search isn't mistaken for an unfiltered one.

## Not now
- Picking several speakers at once.
- Filtering by year, season, or calling.
- Merging **Becky Craven** and **Rebecca L. Craven**. They're the same person, but no simple rule can tell. This would need a hand-written alias.
- Remembering the chosen speaker after a page reload.

## Decisions
- **Layout:** one shared filter for all three searches (your call).
- **Picker:** type-to-search box with the full list available (your call).
- **Where clean names live:** a new `speaker_name` column that the database computes from `speaker` automatically. Re-imports with script 05 fill it in on their own, and the scraper and import scripts stay unchanged. Adding it rewrites the table and rebuilds the vector index once (about 2 minutes, during which search is unavailable). _(my default)_
- **Database changes:**
  - an index on `speaker_name`
  - a `list_speakers()` function that returns each name with its talk count
  - an optional `filter_speaker` argument on `match_sentences()`

  `scripts/01_create_schema.py` gets the same changes so a fresh setup matches. _(my default)_
- **Fast filtered semantic search:** with a speaker chosen, the search checks every sentence by that speaker instead of using the HNSW index. That's at most about 1,600 sentences per speaker, so it's both exact and fast. Without the index, the search can't come back short of 20 results the way a filtered index search can. _(my default)_
- **Fix broken semantic and RAG source links:** `match_sentences()` doesn't return `url` today, so those title links are empty. It will return `url` too, since the function is being changed anyway. _(my default)_
- **Typed name that isn't in the list:** show "Pick a speaker from the list" and don't run the search, so you never get unfiltered results while thinking they're filtered. _(my default)_
- **Edge Functions:** no changes. `generate-answer` already receives only the talks that were found. _(my default)_

## Done when
- Typing "eyr" in the Speaker box suggests **Henry B. Eyring**, and he appears once in the list.
- Keyword "faith" with **Henry B. Eyring** shows only result cards "by … Henry B. Eyring".
- Semantic "peace during hard times" with **Russell M. Nelson** returns 20 results, all by him. Title links open the talk, and the search takes about a second, like an unfiltered one.
- RAG "What has he taught about prayer?" with a speaker lists only that speaker's talks as sources, and the answer cites only them.
- Clearing the box brings back results from all speakers, and all three panels stay 🟢 Ready.
