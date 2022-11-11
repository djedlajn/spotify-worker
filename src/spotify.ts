import { Token } from "./token";
import { base64 } from "rfc4648";
import { Env } from ".";

const SPOTIFY_API_URL = "https://api.spotify.com/v1";
const TOKEN_API_URL = "https://accounts.spotify.com/api/token";

export interface SpotifyRefreshTokenResponse {
  access_token: string;
  token_type: "Bearer";
  scope: string[];
  expires_in: number;
}

export const scopes = [
  "user-top-read",
  "user-read-recently-played",
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-playback-position",
];

// Initialize the axios client

export interface SpotifySdkConfigOptions {
  clientId: string;
  clientSecret: string;
  isInitial?: boolean;
  accessToken?: string;
  refreshToken?: string;
  scopes: string[];
  token?: Token;
}

export const buildSpotifyConfig = (env: Env, token: Token) => {
  const spotifyConfig: SpotifySdkConfigOptions = {
    clientId: env.SPOTIFY_CLIENT_ID,
    clientSecret: env.SPOTIFY_CLIENT_SECRET,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    token: {
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
    },
    scopes,
  };
  return spotifyConfig;
};

export const spotifySdk = (config: SpotifySdkConfigOptions) => {
  /**
   * @description Refresh the access token by providing the refresh token in exchange for a new access token
   * @returns Promise<SpotifyRefreshTokenResponse>
   */
  const refreshToken = async (): Promise<SpotifyRefreshTokenResponse> => {
    const s = base64.stringify(
      new TextEncoder().encode(`${config.clientId}:${config.clientSecret}`),
      { pad: false }
    );

    try {
      const headers = new Headers();

      headers.append("Authorization", `Basic ${s}`);

      headers.append("Content-Type", "application/x-www-form-urlencoded");

      const urlEncoded = new URLSearchParams();
      urlEncoded.append("grant_type", "refresh_token");
      urlEncoded.append("refresh_token", config.token?.refresh_token ?? "");

      const requestOptions = {
        method: "POST",
        headers,
        body: urlEncoded,
      };

      const response = await fetch(TOKEN_API_URL, requestOptions);

      const data = await response.json<SpotifyRefreshTokenResponse>();
      return data;
    } catch (error) {
      return error;
    }
  };

  const currentUser = async () =>
    fetch(`${SPOTIFY_API_URL}/me`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
      },
    }).then((r) => r.json<any>());

  const currentlyPlaying = async () => {
    const headers = new Headers();
    headers.append("Authorization", `Bearer ${config.accessToken}`);
    headers.append("Content-Type", "application/json");

    const requestOptions = {
      method: "GET",
      headers,
    };

    try {
      const response = await fetch(
        `${SPOTIFY_API_URL}/me/player/currently-playing`,
        requestOptions
      );
      if (response.status === 204) {
        return;
      }
      const data = await response.json<any>();
      return data;
    } catch (error) {
      return error;
    }
  };

  return { refreshToken, currentUser, currentlyPlaying };
};
