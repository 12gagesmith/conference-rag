// generate-answer: the "G" in RAG. The browser finds the most relevant talks
// (embed-question + match_sentences) and sends their full text here; GPT-4o
// answers using only those talks and cites them. The OpenAI key stays on the server.
//
// Request:  POST { "question": "...", "context_talks": [{ title, speaker, text }, ...] }
//           (Authorization: Bearer <user session token>)
// Response: { "answer": "..." }   or   { "error": "..." }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

const CHAT_MODEL = "gpt-4o";
const MAX_QUESTION_LENGTH = 2000;
// Caps keep the cost of one request bounded (the app sends the top 3 full talks)
const MAX_TALKS = 5;
const MAX_TALK_CHARS = 40_000;

// app.js shows the answer as escaped plain text, so Markdown would appear as raw symbols
const SYSTEM_PROMPT = `You answer questions about General Conference talks from The Church of Jesus Christ of Latter-day Saints.

Rules:
- Use ONLY the conference talks provided. Do not add outside knowledge.
- Cite every talk you draw from inline by title and speaker, like this: ("Title," Speaker).
- If the talks don't answer the question, say so plainly instead of guessing.
- Write plain text with no Markdown (no headings, bullet points, or bold).
- Keep the answer to about 2-4 short paragraphs.`;

interface ContextTalk {
    title: string;
    speaker: string;
    text: string;
}

// Keep only talks that have text, with fallbacks for missing title/speaker
function parseTalks(value: unknown): ContextTalk[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((talk) => typeof talk?.text === "string" && talk.text.trim())
        .slice(0, MAX_TALKS)
        .map((talk) => ({
            title: typeof talk.title === "string" ? talk.title : "Untitled talk",
            speaker: typeof talk.speaker === "string" ? talk.speaker : "Unknown speaker",
            text: talk.text.slice(0, MAX_TALK_CHARS),
        }));
}

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
        return jsonResponse({ error: 'Request body must be JSON like { "question": "...", "context_talks": [...] }' }, 400);
    }
    if (question.length > MAX_QUESTION_LENGTH) {
        return jsonResponse({ error: `Question must be ${MAX_QUESTION_LENGTH} characters or fewer` }, 400);
    }

    // The app's readiness check sends an empty list on every page load; rejecting it
    // here (any non-404 status counts as "ready") avoids paying for a GPT-4o call each time
    const talks = parseTalks(body?.context_talks);
    if (talks.length === 0) {
        return jsonResponse({ error: "context_talks must include at least one talk with text" }, 400);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
        return jsonResponse({ error: "OPENAI_API_KEY secret is not set (run: supabase secrets set ...)" }, 500);
    }

    const context = talks
        .map((talk, i) => `[${i + 1}] "${talk.title}" by ${talk.speaker}\n${talk.text}`)
        .join("\n\n---\n\n");

    try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openaiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: CHAT_MODEL,
                temperature: 0.3,
                max_completion_tokens: 1000,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: `Conference talks:\n\n${context}\n\n---\n\nQuestion: ${question}` },
                ],
            }),
        });

        if (!res.ok) {
            const detail = await res.json().catch(() => null);
            return jsonResponse({ error: detail?.error?.message ?? `OpenAI request failed (${res.status})` }, 502);
        }

        const data = await res.json();
        const answer = data.choices?.[0]?.message?.content?.trim();
        if (!answer) {
            return jsonResponse({ error: "OpenAI returned an empty answer" }, 502);
        }
        return jsonResponse({ answer });
    } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});
