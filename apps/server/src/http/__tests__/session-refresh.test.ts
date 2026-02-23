import { describe, expect, test } from 'bun:test';
import { testsBaseUrl } from '../../__tests__/setup';
import { eq } from 'drizzle-orm';
import { login } from '../../__tests__/helpers';
import { authSessions, users } from '../../db/schema';
import { createAuthSession } from '../../db/queries/auth-sessions';
import { tdb } from '../../__tests__/setup';

const refreshSession = async (refreshToken: string) => {
  return fetch(`${testsBaseUrl}/auth/session/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      refreshToken
    })
  });
};

describe('/auth/session/refresh', () => {
  test('should return new access and refresh tokens', async () => {
    const loginResponse = await login('testowner', 'password123');

    expect(loginResponse.status).toBe(200);

    const loginData = (await loginResponse.json()) as {
      token: string;
      refreshToken: string;
    };

    expect(loginData.refreshToken).toBeDefined();

    const response = await refreshSession(loginData.refreshToken);

    expect(response.status).toBe(200);

    const data = (await response.json()) as {
      success: boolean;
      token: string;
      refreshToken: string;
    };

    expect(data).toHaveProperty('success', true);
    expect(data).toHaveProperty('token');
    expect(data).toHaveProperty('refreshToken');
    expect(typeof data.token).toBe('string');
    expect(typeof data.refreshToken).toBe('string');
    expect(data.refreshToken).not.toBe(loginData.refreshToken);
    expect(data.token).not.toBe(loginData.token);
  });

  test('should reject reused refresh token', async () => {
    const loginResponse = await login('testowner', 'password123');

    expect(loginResponse.status).toBe(200);

    const loginData = (await loginResponse.json()) as {
      refreshToken: string;
    };

    const firstRefreshResponse = await refreshSession(loginData.refreshToken);

    expect(firstRefreshResponse.status).toBe(200);

    const secondRefreshResponse = await refreshSession(loginData.refreshToken);

    expect(secondRefreshResponse.status).toBe(401);

    const secondData = await secondRefreshResponse.json();

    expect(secondData).toHaveProperty('error', 'Invalid or expired refresh token');
  });

  test('should allow only one winner during concurrent refresh and keep the session usable', async () => {
    const loginResponse = await login('testowner', 'password123');

    expect(loginResponse.status).toBe(200);

    const loginData = (await loginResponse.json()) as {
      refreshToken: string;
    };

    const [firstResponse, secondResponse] = await Promise.all([
      refreshSession(loginData.refreshToken),
      refreshSession(loginData.refreshToken)
    ]);
    const statuses = [firstResponse.status, secondResponse.status].sort();

    expect(statuses).toEqual([200, 401]);

    const winnerResponse =
      firstResponse.status === 200 ? firstResponse : secondResponse;
    const winnerData = (await winnerResponse.json()) as {
      refreshToken: string;
    };

    const followUpRefresh = await refreshSession(winnerData.refreshToken);

    expect(followUpRefresh.status).toBe(200);
  });

  test('should reject invalid refresh token', async () => {
    const response = await refreshSession('invalid-refresh-token');

    expect(response.status).toBe(401);

    const data = await response.json();

    expect(data).toHaveProperty('error', 'Invalid or expired refresh token');
  });

  test('should reject expired refresh token', async () => {
    const { refreshToken, sessionId } = await createAuthSession(1, {
      ip: '127.0.0.1'
    });

    await tdb
      .update(authSessions)
      .set({
        refreshExpiresAt: Date.now() - 1
      })
      .where(eq(authSessions.id, sessionId))
      .run();

    const response = await refreshSession(refreshToken);

    expect(response.status).toBe(401);

    const data = await response.json();

    expect(data).toHaveProperty('error', 'Invalid or expired refresh token');

    const session = await tdb
      .select()
      .from(authSessions)
      .where(eq(authSessions.id, sessionId))
      .get();

    expect(session).toBeDefined();
  });

  test('should reject refresh for banned user sessions', async () => {
    const { refreshToken, sessionId } = await createAuthSession(1, {
      ip: '127.0.0.1'
    });

    await tdb
      .update(users)
      .set({
        banned: true,
        banReason: 'Test ban'
      })
      .where(eq(users.id, 1))
      .run();

    await tdb
      .update(authSessions)
      .set({
        accessExpiresAt: Date.now() + 1000,
        refreshExpiresAt: Date.now() + 1000
      })
      .where(eq(authSessions.id, sessionId))
      .run();

    const response = await refreshSession(refreshToken);

    expect(response.status).toBe(401);

    const data = await response.json();

    expect(data).toHaveProperty('error', 'Invalid or expired refresh token');
  });
});
