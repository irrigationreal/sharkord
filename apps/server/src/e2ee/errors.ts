import { TRPCError } from '@trpc/server';

const badRequest = (message: string): never => {
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message
  });
};

const conflict = (message: string): never => {
  throw new TRPCError({
    code: 'CONFLICT',
    message
  });
};

const forbidden = (message: string): never => {
  throw new TRPCError({
    code: 'FORBIDDEN',
    message
  });
};

export { badRequest, conflict, forbidden };
