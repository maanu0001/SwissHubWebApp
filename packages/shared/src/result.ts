import { toAppError, type AppError, type AppErrorCode } from './errors';

/** Discriminated result used by every server action. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: { code: AppErrorCode; message: string; details?: Record<string, unknown> } };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });

export const fail = (error: unknown): ActionResult<never> => {
  const appError: AppError = toAppError(error);
  return { ok: false, error: appError.toClient() };
};
