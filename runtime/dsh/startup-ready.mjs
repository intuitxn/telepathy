// A required Cordis dependency for agent-loop. Unlike an optional plugin's
// startup error, loss of this service prevents configured agents and provider
// turns. The loader entry requires telepathyUsageMeter for every production
// session, including launches with missing or partial task configuration.
export const name = 'telepathy-startup-ready';
export const inject = ['telepathyToolBoundary'];

export function apply(ctx) {
  if (!process.env.TELEPATHY_TASK_REF || !process.env.TELEPATHY_ROOT_GRANT_REF)
    throw new Error('task launch requires both TELEPATHY_TASK_REF and TELEPATHY_ROOT_GRANT_REF');
  if (!ctx.get?.('telepathyUsageMeter')) throw new Error('task usage meter is not active');
  if (!ctx.get?.('telepathyToolBoundary')) throw new Error('tool boundary is not active');
  ctx.provide('telepathyStartupReady', Object.freeze({ taskConfigured: true }));
}
