import { z } from 'zod';
import { protectedProcedure } from '../../utils/trpc';
import { getUserAuthorizedDevices } from '../../services/e2ee';

const getUserAuthorizedDevicesRoute = protectedProcedure
  .input(
    z.object({
      userId: z.number().int().positive().optional()
    })
  )
  .query(async ({ ctx, input }) => {
    return getUserAuthorizedDevices(input.userId ?? ctx.userId);
  });

export { getUserAuthorizedDevicesRoute };
