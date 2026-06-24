// Augments the wrangler-generated Env interface with secret variables
// that are not declared in wrangler.toml (Cloudflare secrets / env vars).
//
// Also widens SYNC_MODE from the generated literal "merge" to "merge" | "primary"
// since the runtime value may differ from the wrangler.toml default.
interface Env {
  BANGUMI_TOKEN: string
  BANGUMI_REFRESH_TOKEN?: string
  BANGUMI_USERS: string
  BANGUMI_PRIMARY_USER?: string
  BANGUMI_CLIENT_ID?: string
  BANGUMI_CLIENT_SECRET?: string
  CRON_SECRET: string
  SYNC_MODE: "merge" | "primary"
  NSFW_SHOW: "true" | "false"
}
