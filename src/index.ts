import { Hono } from "hono";
import { buildSpotifyConfig, spotifySdk } from "./spotify";
import { DurableState } from "./token";
export { DurableToken } from "./token";
import { logger } from "hono/logger";
import { basicAuth } from "hono/basic-auth";
import { isEmpty } from "lodash";

export interface Env {
  TOKEN: DurableObjectNamespace;
  WORKER_BASE_URL: string;
  API_USERNAME: string;
  API_PASSWORD: string;
  SPOTIFY_ACCESS_TOKEN: string;
  SPOTIFY_REFRESH_TOKEN: string;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());

app.use("/token/*", async (c, next) => {
  const auth = basicAuth({
    username: c.env.API_USERNAME,
    password: c.env.API_PASSWORD,
  });
  return auth(c, next);
});

app.get("/token", async (c) => {
  const id = c.env.TOKEN.idFromName("MAIN_TOKEN");
  const obj = c.env.TOKEN.get(id);
  const resp = await obj.fetch(c.req.url);

  if (resp.status === 404) {
    return c.text("404 Not Found", 404);
  }

  const t = await resp.json<DurableState>();
  return c.json(t);
});

app.get("/playing", async (c) => {
  const id = c.env.TOKEN.idFromName("MAIN_TOKEN");
  const obj = c.env.TOKEN.get(id);
  const url = new URL(`${c.env.WORKER_BASE_URL}/token`);
  const resp = await obj.fetch(url.toString());

  const saveToCache = !isEmpty(c.req.queries("cached"));
  const fromCache = !isEmpty(c.req.queries("fromCache"));
  const purgeCache = !isEmpty(c.req.queries("prugeCache"));

  console.log("CACHES", saveToCache, fromCache);

  if (resp.status === 404) {
    return c.text("404 Not Found", 404);
  }

  const t = await resp.json<DurableState>();

  console.log("PP", JSON.stringify(t.playing));

  if (fromCache && !isEmpty(t.playing)) {
    console.log("Serving from cache");
    return c.json(t.playing);
  }

  const spotifyConfig = buildSpotifyConfig(c.env, t.token);
  const spotify = spotifySdk(spotifyConfig);

  const playing = await spotify.currentlyPlaying();
  console.log("PLAYING", playing);
  if (!playing) {
    return c.notFound();
  }

  if (saveToCache && !purgeCache) {
    const urlCache = new URL(`${c.env.WORKER_BASE_URL}/cache`);
    obj.fetch(urlCache.toString(), {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify(playing),
    });
  }

  if (purgeCache) {
    const urlCache = new URL(`${c.env.WORKER_BASE_URL}/purge`);
    obj.fetch(urlCache.toString(), {
      method: "DELETE",
    });
  }

  return c.json(playing);
});

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    const id = env.TOKEN.idFromName("MAIN_TOKEN");
    const obj = env.TOKEN.get(id);
    const url = new URL(`${env.WORKER_BASE_URL}/refresh`);
    ctx.waitUntil(obj.fetch(url.toString()));
    console.log("[Cron] Scheduled done");
  },
};
