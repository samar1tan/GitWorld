import type { ClosePreparationResult } from '@gitworld/contracts';

/** An asynchronous close request can be cancelled without trusting a late result. */
export function createClosePreparation(options: { freeze: () => void; flush: () => Promise<void>; resume: () => void; failed: (error: unknown) => void; hasUnsavedInput: () => boolean }) {
  let sequence = 0;
  let active = false;
  function resume() { if (active) { active = false; options.resume(); } }
  return {
    async prepare(): Promise<ClosePreparationResult> {
      const token = ++sequence;
      active = true; options.freeze();
      try {
        await options.flush();
        if (token !== sequence || !active) return { ready: false, reason: 'save-failed' };
        return options.hasUnsavedInput() ? { ready: false, reason: 'unsaved-input' } : { ready: true };
      }
      catch (error) {
        if (token === sequence) { sequence++; resume(); options.failed(error); }
        return { ready: false, reason: 'save-failed' };
      }
    },
    cancel() { sequence++; resume(); },
  };
}
