/**
 * SAMPLE FILE: access_control.ts
 *
 * This is a stub for project-scoped API key validation and access restrictions.
 *
 * INSTRUCTIONS:
 * 1. Rename this file from `access_control.sample.ts` to `access_control.ts`
 * 2. Implement your own authentication mechanism (e.g. database-backed tokens).
 * 3. Validate requests against permitted project IDs.
 */

export async function isAllowed(apiKey: string, project: string): Promise<boolean> {
  // Implement your security checks here
  // Example: check if apiKey is valid and has access to the specified project
  
  console.warn("Using sample access_control.ts. WARNING: Defaulting to DENY.");
  return false;
}