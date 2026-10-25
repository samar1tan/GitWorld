import { writeFile } from 'node:fs/promises';
import { acquireMetObjects, exportPackageCsv, loadDataPackageFile, replayMetStaging } from './index.ts';
const [command, ...args] = process.argv.slice(2);
let result: unknown;
if (command === 'validate' && args[0]) {
  const mode = args.includes('--publish') ? 'publish' : 'draft'; const parsed = await loadDataPackageFile(args[0], mode);
  result = { ok: parsed.ok, issues: parsed.issues, report: parsed.report }; if (!parsed.ok) process.exitCode = 1;
} else if (command === 'csv' && args.length === 2) {
  const parsed = await loadDataPackageFile(args[0]);
  if (parsed.package) { await writeFile(args[1], exportPackageCsv(parsed.package)); result = { ok: true }; }
  else { result = parsed; process.exitCode = 1; }
} else if (command === 'met') {
  const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  const objectIds = (option('--ids') ?? '').split(',').map(Number);
  const acquired = await acquireMetObjects({ objectIds, stagingDirectory: option('--staging'), dryRun: args.includes('--dry-run') });
  result = { ok: acquired.ok, report: acquired.report }; if (!acquired.ok) process.exitCode = 1;
} else if (command === 'replay' && args.length === 1) {
  const replayed = await replayMetStaging(args[0]); result = { ok: replayed.ok, report: replayed.report }; if (!replayed.ok) process.exitCode = 1;
} else {
  result = { ok: false, usage: ['validate <package.json|csv> [--publish]', 'csv <package.json> <output.csv>', 'met --ids 436535 [--dry-run | --staging .local/ingestion]', 'replay <staged-run-directory>'] }; process.exitCode = 1;
}
console.log(JSON.stringify(result, null, 2));
