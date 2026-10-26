import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsonResponse } from "./cors.ts";

// Functions are deployed with --no-verify-jwt (the gateway can't verify Supabase's newer
// ES256 session tokens), so each function checks the caller itself. auth.getUser() asks
// Supabase Auth to validate the token, which works for both old and new token types.
//
// A signed-out browser sends the anon key as its token, which has no user, so it gets a 401.
export async function requireUser(req: Request) {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) {
        return { error: jsonResponse({ error: "Missing Authorization header" }, 401) };
    }

    const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        return { error: jsonResponse({ error: "Invalid or expired session. Please sign in." }, 401) };
    }
    return { user };
}
