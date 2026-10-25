import type { EditorialJson } from './editorial-types.ts';

/** Local interface preferences and recoverable input, outside authored data revisions. */
export type ClientStateKey = 'onboarding' | 'knowledge-view' | 'research-input' | 'locale' | 'workspace-section' | 'commit-input' | 'commit-attempt' | 'source-query' | 'terminal-input' | 'object-input' | 'wikipedia-input' | 'context-input';
export type ClientStateEntry = { key: ClientStateKey; version: number; value: EditorialJson };
export const CLIENT_STATE_KEYS: readonly ClientStateKey[] = ['onboarding', 'knowledge-view', 'research-input', 'locale', 'workspace-section', 'commit-input', 'commit-attempt', 'source-query', 'terminal-input', 'object-input', 'wikipedia-input', 'context-input'];
