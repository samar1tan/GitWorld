import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export const SMOKE_DEADLINE_MS = 210_000;
export const SMOKE_KILL_GRACE_MS = 5_000;
const REAP_GRACE_MS = 1_000;

/** Smaller budgets are for technical tests; the production entry passes the fixed deadline. */
export function runSmokeProcess(executable, args, { env, deadlineMs = SMOKE_DEADLINE_MS, killGraceMs = SMOKE_KILL_GRACE_MS } = {}) {
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > SMOKE_DEADLINE_MS || !Number.isInteger(killGraceMs) || killGraceMs < 1 || killGraceMs > SMOKE_KILL_GRACE_MS) throw new Error('INVALID_SMOKE_BUDGET');
  const started = performance.now();
  return new Promise(resolve => {
    let child, deadlineTimer, killTimer, reapTimer, finished = false, timedOut = false, output = '', errors = '';
    const terminationSignals = [];
    const finish = (code, signal, closeObserved, spawnError = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadlineTimer); clearTimeout(killTimer); clearTimeout(reapTimer);
      const durationMs = performance.now() - started;
      // A delayed timer callback must not let an already-late close become a pass.
      timedOut ||= durationMs >= deadlineMs;
      resolve({ code, signal, closeObserved, spawnError, timedOut, durationMs, deadlineMs, output, errors, terminationSignals });
    };
    const signalChild = signal => {
      try { if (child.kill(signal)) terminationSignals.push(signal); } catch { /* The result still fails; no unrelated process is targeted. */ }
    };
    try { child = spawn(executable, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { finish(-1, null, false, true); return; }
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { errors += data; });
    child.once('error', () => finish(-1, null, false, true));
    child.once('close', (code, signal) => finish(code, signal, true));
    const expire = () => {
      if (finished) return;
      const remaining = deadlineMs - (performance.now() - started);
      if (remaining > 0) { deadlineTimer = setTimeout(expire, Math.ceil(remaining)); return; }
      timedOut = true;
      signalChild('SIGTERM');
      if (finished) return;
      killTimer = setTimeout(() => {
        if (finished) return;
        signalChild('SIGKILL');
        if (finished) return;
        reapTimer = setTimeout(() => {
          if (finished) return;
          // A descendant retaining a pipe or an unresponsive child cannot hold the harness forever.
          child.stdout.destroy(); child.stderr.destroy(); child.unref();
          finish(child.exitCode, child.signalCode, false);
        }, REAP_GRACE_MS);
      }, killGraceMs);
    };
    deadlineTimer = setTimeout(expire, Math.ceil(Math.max(0, deadlineMs - (performance.now() - started))));
  });
}

/** Only this decision may become the engineering receipt; stderr is never included. */
export function evaluateSmokeProcess(observed, packaged) {
  const timedOut = observed.timedOut || observed.durationMs >= observed.deadlineMs;
  const phase = observed.errors.match(/GITWORLD_SMOKE_ERROR ([a-z-]{1,80})/)?.[1];
  const summary = { packaged, timedOut, durationMs: observed.durationMs, deadlineMs: observed.deadlineMs, exitCode: observed.code, signal: observed.signal, closeObserved: observed.closeObserved, ...(phase ? { startupPhase: phase } : {}) };
  const fail = reason => ({ ok: false, record: { ok: false, ...summary, reason } });
  if (timedOut) return fail('deadline');
  if (observed.spawnError || observed.code !== 0 || !observed.closeObserved) return fail('process-exit');
  const line = observed.output.split('\n').find(value => value.startsWith('GITWORLD_SMOKE_RESULT '));
  if (!line) return fail('missing-receipt');
  let result;
  try { result = JSON.parse(line.slice('GITWORLD_SMOKE_RESULT '.length)); } catch { return fail('invalid-receipt'); }
  if (!result || result.ok !== true || result.packaged !== packaged) return fail('failed-receipt');
  return { ok: true, record: { ...result, ...summary } };
}
