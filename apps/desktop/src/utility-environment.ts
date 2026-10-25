/** Keep the utility's existing environment boundary without undefined native values. */
export function utilityEnvironment(environment: Readonly<Record<string, unknown>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ['PATH', 'LANG', 'TMPDIR'] as const) {
    const value = environment[key];
    if (typeof value === 'string') result[key] = value;
  }
  // Electron treats an empty environment map as a request to inherit everything.
  if (Object.keys(result).length === 0) throw new Error('UTILITY_ENVIRONMENT_EMPTY');
  return result;
}
