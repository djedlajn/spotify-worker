import { Hono } from "hono";
import { Env } from ".";
import { buildSpotifyConfig, spotifySdk } from "./spotify";
import { add } from "date-fns";

export interface Token {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  initial?: boolean;
}

export interface DurableState {
  token: Token;
  cacheDuration: number;
  expiresAt: Date | null;
  playing: Record<string, any>;
}

export class DurableToken {
  token: Token = {};
  cacheDuration: number;
  expiresAt: Date | null = null;
  playing: Record<string, any> = {};
  state: DurableObjectState;
  app: Hono = new Hono();

  constructor(state: DurableObjectState, env: Env) {
    console.log("[DurableToken] constructor");
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage?.get<Token>("token");
      const duration = await this.state.storage?.get<number>("cacheDuration");
      const playing = await this.state.storage?.get<Record<string, any>>(
        "playing"
      );
      const expiresAt = await this.state.storage?.get<Date | null>("expiresAt");
      this.token = stored || {
        access_token: env.SPOTIFY_ACCESS_TOKEN,
        refresh_token: env.SPOTIFY_REFRESH_TOKEN,
        initial: true,
      };
      this.cacheDuration = duration || 30;
      this.playing = playing || {};
      this.expiresAt = expiresAt || null;
    });

    this.app.get("/token", async (c) => {
      const t = this.token;

      const spotifyConfig = buildSpotifyConfig(env, t);

      if (t.initial) {
        console.log("[Durable Object] Initial token flow");
        const spotify = spotifySdk(spotifyConfig);
        const newToken = await spotify.refreshToken();
        this.token.initial = false;
        this.token.access_token = newToken.access_token;
        this.state.blockConcurrencyWhile(async () => {
          this.state.storage?.put<Token>("token", this.token);
        });
      }
      console.log("[Durable Object] Token flow");
      return c.json<DurableState>({
        token: this.token,
        cacheDuration: this.cacheDuration,
        playing: this.playing,
        expiresAt: null,
      });
    });

    this.app.post("/cache", async (c) => {
      console.log("[Durable Object] Chacing");
      const playing = await c.req.json();
      this.playing = playing;
      const now = new Date();
      const expiresAt = add(now, { seconds: this.cacheDuration });
      this.expiresAt = expiresAt;
      this.state.blockConcurrencyWhile(async () => {
        await this.state.storage?.put({ playing, expiresAt });
      });
    });

    this.app.delete("/purge", async (_c) => {
      console.log("[Durable Object] Purging");
      this.expiresAt = null;
      this.state.blockConcurrencyWhile(async () => {
        await this.state.storage.delete("playing");
      });
    });

    this.app.get("/refresh", async (c) => {
      console.log("[Durable Object] Refreshing token");
      const spotifyConfig = buildSpotifyConfig(env, this.token);

      const spotify = spotifySdk(spotifyConfig);
      const newToken = await spotify.refreshToken();
      this.token.access_token = newToken.access_token;
      this.state.blockConcurrencyWhile(async () => {
        this.state.storage?.put<Token>("token", this.token);
        console.log("[Durable Object] Saved new token");
      });
      return c.json(this.token);
    });
  }

  async fetch(request: Request) {
    return this.app.fetch(request);
  }
}
