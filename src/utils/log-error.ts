/**
 * Preserve stacks, causes, and structured rejection values in stderr output.
 */

export function logError(error: unknown, message: string): void {
  console.error(`${message}:`, error);
}
