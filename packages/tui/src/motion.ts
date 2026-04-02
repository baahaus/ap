function envFlag(name: string): boolean {
  const value = process.env[name];
  return value === '1' || value === 'true';
}

export function prefersReducedMotion(): boolean {
  return envFlag('BLUSH_REDUCED_MOTION')
    || envFlag('CI')
    || process.env.TERM === 'dumb';
}

export async function pause(ms: number): Promise<void> {
  if (ms <= 0 || prefersReducedMotion()) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}
