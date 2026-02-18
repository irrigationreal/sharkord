import { OWNER_ROLE_ID } from '@sharkord/shared';
import { z } from 'zod';
import { db } from '../../db';
import { userRoles } from '../../db/schema';
import { getOwnerBootstrapTokenHash } from '../../helpers/server-secrets';
import { publishUser } from '../../db/publishers';
import { getSettings } from '../../db/queries/server';
import { invariant } from '../../utils/invariant';
import { protectedProcedure } from '../../utils/trpc';

const useSecretTokenRoute = protectedProcedure
  .input(
    z.object({
      token: z.string()
    })
  )
  .mutation(async ({ input, ctx }) => {
    const settings = await getSettings();
    const storedSecretToken = settings.secretToken;
    const modernHashedToken = getOwnerBootstrapTokenHash(input.token);

    const isModernMatch = storedSecretToken === modernHashedToken;

    invariant(isModernMatch, {
      code: 'FORBIDDEN',
      message: 'Invalid secret token'
    });

    await db
      .insert(userRoles)
      .values({
        userId: ctx.userId,
        roleId: OWNER_ROLE_ID,
        createdAt: Date.now()
      })
      .onConflictDoNothing()
      .run();

    publishUser(ctx.userId, 'update');
  });

export { useSecretTokenRoute };
