import { getUrlFromServer } from './get-file-url';
import {
  getSessionStorageItem,
  removeSessionStorageItem,
  setSessionStorageItem,
  SessionStorageKey
} from './storage';

type TTokenPair = {
  token: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
};

const REFRESH_BUFFER_MS = 60_000;
let refreshInFlight: Promise<string> | null = null;
let refreshInFlightToken: string | null = null;

const parseExpiresAt = (value: string | null): number | undefined => {
  if (!value) return undefined;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return undefined;

  return parsed;
};

const clearSessionStorage = () => {
  removeSessionStorageItem(SessionStorageKey.TOKEN);
  removeSessionStorageItem(SessionStorageKey.REFRESH_TOKEN);
  removeSessionStorageItem(SessionStorageKey.ACCESS_TOKEN_EXPIRES_AT);
  removeSessionStorageItem(SessionStorageKey.REFRESH_TOKEN_EXPIRES_AT);
};

const setAuthSession = (data: TTokenPair) => {
  setSessionStorageItem(SessionStorageKey.TOKEN, data.token);
  setSessionStorageItem(SessionStorageKey.REFRESH_TOKEN, data.refreshToken);
  setSessionStorageItem(
    SessionStorageKey.ACCESS_TOKEN_EXPIRES_AT,
    String(data.accessExpiresAt)
  );
  setSessionStorageItem(
    SessionStorageKey.REFRESH_TOKEN_EXPIRES_AT,
    String(data.refreshExpiresAt)
  );
};

const refreshAccessToken = async (refreshToken: string): Promise<string> => {
  try {
    const response = await fetch(
      `${getUrlFromServer()}/auth/session/refresh`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refreshToken })
      }
    );

    if (!response.ok) {
      clearSessionStorage();

      return '';
    }

    const payload = (await response.json()) as TTokenPair;

    if (!payload.token || !payload.refreshToken) {
      clearSessionStorage();

      return '';
    }

    const accessExpiresAt = payload.accessExpiresAt ?? 0;
    const refreshExpiresAt = payload.refreshExpiresAt ?? 0;

    if (
      typeof accessExpiresAt !== 'number' ||
      typeof refreshExpiresAt !== 'number'
    ) {
      clearSessionStorage();

      return '';
    }

    // Avoid clobbering a newer login/session if this refresh resolved late.
    if (getSessionStorageItem(SessionStorageKey.REFRESH_TOKEN) === refreshToken) {
      setAuthSession({
        token: payload.token,
        refreshToken: payload.refreshToken,
        accessExpiresAt,
        refreshExpiresAt
      });
    } else {
      return getSessionStorageItem(SessionStorageKey.TOKEN) || '';
    }

    return payload.token;
  } catch {
    clearSessionStorage();

    return '';
  }
};

const startRefresh = (refreshToken: string): Promise<string> => {
  const promise = refreshAccessToken(refreshToken).finally(() => {
    if (refreshInFlight === promise) {
      refreshInFlight = null;
      refreshInFlightToken = null;
    }
  });
  refreshInFlight = promise;
  refreshInFlightToken = refreshToken;

  return promise;
};

const getValidSessionToken = async (): Promise<string> => {
  const token = getSessionStorageItem(SessionStorageKey.TOKEN);

  if (!token) {
    return '';
  }

  const accessExpiresAt = parseExpiresAt(
    getSessionStorageItem(SessionStorageKey.ACCESS_TOKEN_EXPIRES_AT)
  );

  if (accessExpiresAt === undefined) {
    clearSessionStorage();

    return '';
  }

  if (Date.now() < accessExpiresAt - REFRESH_BUFFER_MS) {
    return token;
  }

  const refreshToken = getSessionStorageItem(SessionStorageKey.REFRESH_TOKEN);
  const refreshExpiresAt = parseExpiresAt(
    getSessionStorageItem(SessionStorageKey.REFRESH_TOKEN_EXPIRES_AT)
  );

  if (!refreshToken || refreshExpiresAt === undefined) {
    clearSessionStorage();

    return '';
  }

  if (Date.now() > refreshExpiresAt) {
    clearSessionStorage();

    return '';
  }

  if (!refreshInFlight || refreshInFlightToken !== refreshToken) {
    return startRefresh(refreshToken);
  }

  return refreshInFlight;
};

export {
  clearSessionStorage,
  getValidSessionToken,
  parseExpiresAt,
  setAuthSession
};
