// Default game server for Solar Odyssey.
//
// This is a Supabase ANON (public) key. It is designed to be shipped in
// client-side JavaScript — every Supabase web app has one in its bundle. It
// grants nothing on its own: `supabase/schema.sql` enables row-level security
// on every table, so a caller can only read public rows (server list, public
// rocket designs) and can only read/write their OWN saves, settings, friends
// and presence after signing in. Never put the SERVICE ROLE key here.
//
// Players can still point the game at their own project at runtime
// (ACCOUNT → CONNECT SERVER), which overrides these defaults, and
// VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY override them at build time.
export const DEFAULT_BACKEND = {
  url: 'https://xzlimjmnspjmqjyqqxam.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6bGltam1uc3BqbXFqeXFxeGFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3NzAwMjgsImV4cCI6MjEwNDM0NjAyOH0.SfbUtmVIATdY7UXdrSUSALjoovPd7PCcQF452PD7l8s'
};
