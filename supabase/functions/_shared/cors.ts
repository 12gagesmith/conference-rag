// CORS headers so the GitHub Pages site (a different origin) can call these functions.
// supabase-js sends the authorization, apikey, and x-client-info headers on every invoke().
export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// JSON response that always carries the CORS headers (the browser drops responses without them)
export function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
