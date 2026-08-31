/* Scheduled every 15 minutes by Netlify's cron. Not HTTP-invocable in production —
   use refresh-now for a manual pull. */
import { runRefresh } from "../lib/sources.mjs";

export default async () => {
  const result = await runRefresh();
  console.log("[cheeto] refresh", JSON.stringify(result));
  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
};

export const config = { schedule: "*/15 * * * *" };
