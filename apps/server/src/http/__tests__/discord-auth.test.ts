import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, test } from 'bun:test';
import { tdb, testsBaseUrl } from '../../__tests__/setup';
import { login } from '../../__tests__/helpers';
import { authIdentities, invites, oauthStates, settings, users } from '../../db/schema';

type TGlobalFetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const withMockedDiscordFetch = (
  discordUserId: string,
  tokenResponse: string
) => {
  const originalFetch = (globalThis as unknown as { fetch: TGlobalFetch }).fetch;

  const calls: string[] = [];

  const mockedFetch: TGlobalFetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : String(input);
    calls.push(url);

    if (!url.startsWith('https://discord.com/api')) {
      return originalFetch(input, init);
    }

    if (url === 'https://discord.com/api/oauth2/token') {
      return new Response(
        JSON.stringify({
          access_token: tokenResponse
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    if (url === 'https://discord.com/api/users/@me') {
      return new Response(
        JSON.stringify({
          id: discordUserId,
          username: 'Discord Username'
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return originalFetch(input, init);
  };

  (globalThis as unknown as { fetch: TGlobalFetch }).fetch = mockedFetch;

  return {
    calls,
    restore: () => {
      (globalThis as unknown as { fetch: TGlobalFetch }).fetch = originalFetch;
    }
  };
};

describe('/auth/discord', () => {
  const clientId = 'discord-test-client-id';
  const clientSecret = 'discord-test-secret';
  const redirectPath = '/channels';
  const deviceId = 'test-device-id';
  const inviteCode = 'INVITE-CODE';

  beforeAll(() => {
    process.env.DISCORD_CLIENT_ID = clientId;
    process.env.DISCORD_CLIENT_SECRET = clientSecret;
  });

  test('should persist OAuth state and redirect to Discord on /auth/discord/start', async () => {
    const response = await fetch(
      `${testsBaseUrl}/auth/discord/start?invite=${inviteCode}&redirectPath=${encodeURIComponent(redirectPath)}&deviceId=${encodeURIComponent(deviceId)}`,
      { redirect: 'manual' }
    );
    const responseText = await response.text();

    if (response.status !== 302) {
      throw new Error(`Expected 302 redirect but got ${response.status}: ${responseText}`);
    }

    const location = response.headers.get('location');
    expect(location).toBeTruthy();

    const parsedLocation = new URL(location!);
    const state = parsedLocation.searchParams.get('state');

    expect(parsedLocation.host).toBe('discord.com');
    expect(parsedLocation.pathname).toBe('/oauth2/authorize');
    expect(parsedLocation.searchParams.get('scope')).toBe('identify');
    expect(parsedLocation.searchParams.get('client_id')).toBe(clientId);
    expect(state).toBeDefined();

    const stateHash = sha256(state!);
    const storedState = await tdb
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.stateHash, stateHash))
      .get();

    expect(storedState).toBeDefined();
    expect(storedState?.provider).toBe('discord');
    expect(storedState?.inviteCode).toBe(inviteCode);
    expect(storedState?.deviceId).toBe(deviceId);
    expect(storedState?.redirectPath).toBe(redirectPath);
  });

  test('should complete callback flow and create OAuth identity/session', async () => {
    const startResponse = await fetch(
      `${testsBaseUrl}/auth/discord/start?invite=${inviteCode}&redirectPath=${encodeURIComponent(redirectPath)}&deviceId=${encodeURIComponent(deviceId)}`,
      { redirect: 'manual' }
    );

    const startLocation = new URL(startResponse.headers.get('location')!);
    const state = startLocation.searchParams.get('state');

    const discordId = '111111111111111111';
    const mockedFetch = withMockedDiscordFetch(discordId, 'discord-access-token');

    try {
      const callbackResponse = await fetch(
        `${testsBaseUrl}/auth/discord/callback?code=discord-auth-code&state=${state}&mode=json`
      );
      const callbackData = (await callbackResponse.json()) as {
        success?: boolean;
        token?: string;
        refreshToken?: string;
      };

      expect(callbackResponse.status).toBe(200);
      expect(callbackData).toHaveProperty('success', true);
      expect(callbackData).toHaveProperty('token');
      expect(callbackData).toHaveProperty('refreshToken');
      expect(mockedFetch.calls).toContain(
        'https://discord.com/api/oauth2/token'
      );
      expect(mockedFetch.calls).toContain(
        'https://discord.com/api/users/@me'
      );

      const identity = await tdb
        .select()
        .from(users)
        .where(eq(users.identity, `discord:${discordId}`))
        .get();

      expect(identity).toBeDefined();
      expect(identity?.name).toBe('Discord Username');

      const linked = await tdb
        .select()
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.provider, 'discord'),
            eq(authIdentities.providerSubject, discordId)
          )
        )
        .get();

      expect(linked).toBeDefined();
      expect(linked?.userId).toBe(identity!.id);
    } finally {
      mockedFetch.restore();
    }
  });

  test('should reject reused OAuth state on second callback attempt', async () => {
    const startResponse = await fetch(
      `${testsBaseUrl}/auth/discord/start?redirectPath=${encodeURIComponent(redirectPath)}`,
      { redirect: 'manual' }
    );

    const state = new URL(startResponse.headers.get('location')!).searchParams.get(
      'state'
    );
    const mockedFetch = withMockedDiscordFetch('222222222222222222', 'discord-access-token');

    try {
      const firstCallback = await fetch(
        `${testsBaseUrl}/auth/discord/callback?code=first-code&state=${state}&mode=json`
      );
      expect(firstCallback.status).toBe(200);

      const secondCallback = await fetch(
        `${testsBaseUrl}/auth/discord/callback?code=second-code&state=${state}&mode=json`
      );
      const secondData = (await secondCallback.json()) as { error?: string };

      expect(secondCallback.status).toBe(400);
      expect(secondData).toHaveProperty(
        'error',
        'invalid_state'
      );
    } finally {
      mockedFetch.restore();
    }
  });

  test('should require valid invite when allowNewUsers is false', async () => {
    await tdb.update(settings).set({ allowNewUsers: false }).run();

    const startResponse = await fetch(
      `${testsBaseUrl}/auth/discord/start?redirectPath=${encodeURIComponent(redirectPath)}`,
      { redirect: 'manual' }
    );

    const state = new URL(startResponse.headers.get('location')!).searchParams.get(
      'state'
    );

    const discordId = '333333333333333333';
    const mockedFetch = withMockedDiscordFetch(discordId, 'discord-access-token');

    try {
      const callbackResponse = await fetch(
        `${testsBaseUrl}/auth/discord/callback?code=discord-auth-code&state=${state}&mode=json`
      );
      const callbackData = (await callbackResponse.json()) as {
        error?: string;
      };

      expect(callbackResponse.status).toBe(400);
      expect(callbackData).toHaveProperty('error', 'invite_required');

      const linked = await tdb
        .select()
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.provider, 'discord'),
            eq(authIdentities.providerSubject, discordId)
          )
        )
        .get();

      expect(linked).toBeUndefined();
    } finally {
      mockedFetch.restore();
      await tdb.update(settings).set({ allowNewUsers: true }).run();
    }
  });

  test('should allow first OAuth user creation with valid invite when allowNewUsers is false', async () => {
    await tdb
      .insert(invites)
      .values({
        code: inviteCode,
        creatorId: 1,
        maxUses: 2,
        uses: 0,
        expiresAt: Date.now() + 60 * 60 * 1000,
        createdAt: Date.now()
      });

    await tdb.update(settings).set({ allowNewUsers: false }).run();

    const startResponse = await fetch(
      `${testsBaseUrl}/auth/discord/start?invite=${inviteCode}&redirectPath=${encodeURIComponent(redirectPath)}`,
      { redirect: 'manual' }
    );

    const state = new URL(startResponse.headers.get('location')!).searchParams.get(
      'state'
    );

    const discordId = '444444444444444444';
    const mockedFetch = withMockedDiscordFetch(discordId, 'discord-access-token');

    try {
      const callbackResponse = await fetch(
        `${testsBaseUrl}/auth/discord/callback?code=discord-auth-code&state=${state}&mode=json`
      );
      const callbackData = (await callbackResponse.json()) as {
        success?: boolean;
      };

      expect(callbackResponse.status).toBe(200);
      expect(callbackData).toHaveProperty('success', true);

      const updatedInvite = await tdb
        .select()
        .from(invites)
        .where(eq(invites.code, inviteCode))
        .get();

      expect(updatedInvite?.uses).toBe(1);
    } finally {
      mockedFetch.restore();
      await tdb
        .update(settings)
        .set({ allowNewUsers: true })
        .run();
    }
  });

  test('should revoke session on /auth/logout', async () => {
    const loginResponse = await login('testowner', 'password123');
    const loginData = (await loginResponse.json()) as {
      token: string;
      refreshToken: string;
    };
    const token = loginData.token;

    const logoutResponse = await fetch(`${testsBaseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token })
    });

    expect(logoutResponse.status).toBe(200);
    const logoutData = (await logoutResponse.json()) as { success: boolean };
    expect(logoutData).toHaveProperty('success', true);

    const sessionRefreshResponse = await fetch(`${testsBaseUrl}/auth/session/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refreshToken: loginData.refreshToken })
    });

    expect(sessionRefreshResponse.status).toBe(401);
  });
});
