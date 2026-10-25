import type { KnowledgeMappingPreview } from '../../../../packages/contracts/src/knowledge-workspace-types.ts';

/** Emitted only after successful application responses; no tutorial action is simulated. */
export type SourceObservation =
  | { type: 'data-acquired'; jobId: string }
  | { type: 'data-previewed'; jobId: string; inputHash?: string }
  | { type: 'data-adopted'; jobId: string; paths?: string[]; inputHash?: string };

export const isSourceInputHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Legacy unprepared previews do not acquire a synthetic prepared identity. */
export function preparedInputHash(preview: KnowledgeMappingPreview): string | undefined {
  return preview.prepared?.fingerprintVersion === 2 && isSourceInputHash(preview.prepared.id) && /^[a-f0-9]{40}$/.test(preview.prepared.baseHead) && isSourceInputHash(preview.inputHash) ? preview.inputHash : undefined;
}
