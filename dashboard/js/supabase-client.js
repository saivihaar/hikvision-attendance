// Public/anon values only - this file is safe to expose in a browser.
// Get these from Supabase: Project Settings -> API.
const SUPABASE_URL = "https://kmnhqtracqfpintngxgi.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hY1GPTeIiULSK8uqH5fUxQ_dt39pNoH";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
