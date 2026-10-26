// embed-question: turns a user's question into a 1,536-dimension vector so the
// browser can call match_sentences() with it. The OpenAI key stays on the server.
//
// Request:  POST { "question": "..." }   (Authorization: Bearer <user session token>)
// Response: { "embedding": [ ...1536 numbers ] }   or   { "error": "..." }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

// Must match the model used in scripts/04_embed_data.py, or the vectors won't be comparable
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_QUESTION_LENGTH = 2000;

Deno.serve(async (req) => {
    // CORS preflight: the browser asks permission before the real POST
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
        return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const auth = await requireUser(req);
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => null);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (!question) {
        return jsonResponse({ error: 'Request body must be JSON like { "question": "..." }' }, 400);
    }
    if (question.length > MAX_QUESTION_LENGTH) {
        return jsonResponse({ error: `Question must be ${MAX_QUESTION_LENGTH} characters or fewer` }, 400);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
        return jsonResponse({ error: "OPENAI_API_KEY secret is not set (run: supabase secrets set ...)" }, 500);
    }

    try {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openaiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ model: EMBEDDING_MODEL, input: question }),
        });

        if (!res.ok) {
            const detail = await res.json().catch(() => null);
            return jsonResponse({ error: detail?.error?.message ?? `OpenAI request failed (${res.status})` }, 502);
        }

        const data = await res.json();
        return jsonResponse({ embedding: data.data[0].embedding });
    } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});
