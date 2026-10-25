import test from 'node:test';
import assert from 'node:assert/strict';
import { runSmokeProcess, evaluateSmokeProcess, SMOKE_DEADLINE_MS, SMOKE_KILL_GRACE_MS } from '../smoke-process.mjs';

const receipt = `GITWORLD_SMOKE_RESULT ${JSON.stringify({ ok: true, packaged: true, runtime: { fixture: true } })}`;
const node = (code, options = {}) => runSmokeProcess(process.execPath, ['-e', code], { env: { PATH: '/nonexistent' }, deadlineMs: 5000, ...options });

test('the fixed production budget exceeds initialization and a normal technical child can pass', async () => {
  assert.equal(SMOKE_DEADLINE_MS, 210000);
  assert.equal(SMOKE_KILL_GRACE_MS, 5000);
  const observed = await node(`console.log(${JSON.stringify(receipt)})`), result = evaluateSmokeProcess(observed, true);
  assert.equal(observed.timedOut, false); assert.equal(observed.code, 0); assert.equal(observed.closeObserved, true);
  assert.ok(observed.durationMs > 0 && observed.durationMs < observed.deadlineMs);
  assert.deepEqual(observed.terminationSignals, []);
  assert.equal(result.ok, true); assert.equal(result.record.timedOut, false); assert.equal(result.record.durationMs, observed.durationMs);
});

test('a valid-looking receipt cannot override nonzero exit or leak child stderr', async () => {
  const observed = await node(`console.log(${JSON.stringify(receipt)});console.error('PRIVATE_TECHNICAL_SENTINEL');process.exitCode=7`), result = evaluateSmokeProcess(observed, true);
  assert.equal(result.ok, false); assert.equal(result.record.ok, false); assert.equal(result.record.exitCode, 7);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TECHNICAL_SENTINEL/);
});

test('a timed-out child which handles SIGTERM and then emits a successful receipt still fails', { timeout: 5000 }, async () => {
  const observed = await node(`process.on('SIGTERM',()=>setTimeout(()=>{console.log(${JSON.stringify(receipt)});process.exit(0)},20));setInterval(()=>{},1000)`, { deadlineMs: 1000, killGraceMs: 500 }), result = evaluateSmokeProcess(observed, true);
  assert.equal(observed.timedOut, true); assert.equal(observed.code, 0); assert.match(observed.output, /GITWORLD_SMOKE_RESULT/);
  assert.ok(observed.durationMs >= 1000); assert.ok(observed.terminationSignals.includes('SIGTERM'));
  assert.equal(result.ok, false); assert.equal(result.record.ok, false); assert.equal(result.record.reason, 'deadline');
});

test('SIGTERM-resistant technical children are killed after a bounded grace instead of hanging', { timeout: 5000 }, async () => {
  const observed = await node("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)", { deadlineMs: 1000, killGraceMs: 100 });
  assert.equal(observed.timedOut, true); assert.equal(observed.signal, 'SIGKILL'); assert.equal(observed.closeObserved, true);
  assert.deepEqual(observed.terminationSignals, ['SIGTERM','SIGKILL']);
  assert.ok(observed.durationMs >= 1000 && observed.durationMs < 4000);
  assert.equal(evaluateSmokeProcess(observed, true).ok, false);
});

test('failed process creation and malformed or wrong-mode receipts never pass', async () => {
  const failed = await runSmokeProcess('/nonexistent/gitworld-technical-child', [], { deadlineMs: 100 });
  assert.equal(failed.spawnError, true); assert.equal(evaluateSmokeProcess(failed, true).ok, false);
  for (const text of ['GITWORLD_SMOKE_RESULT {invalid', 'GITWORLD_SMOKE_RESULT {"ok":true,"packaged":false}', 'no receipt']) {
    const observed = await node(`console.log(${JSON.stringify(text)})`);
    assert.equal(evaluateSmokeProcess(observed, true).ok, false);
  }
});

test('late elapsed time cannot pass even if a delayed deadline callback has not set its flag', () => {
  const result = evaluateSmokeProcess({ code:0, signal:null, closeObserved:true, spawnError:false, timedOut:false, durationMs:210001, deadlineMs:210000, output:receipt, errors:'' }, true);
  assert.equal(result.ok, false); assert.equal(result.record.timedOut, true); assert.equal(result.record.ok, false);
});
