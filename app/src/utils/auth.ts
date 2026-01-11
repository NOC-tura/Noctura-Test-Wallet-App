/**
 * Authentication gate for sensitive operations (reveal amounts, etc).
 * Uses simple password confirmation for now; could be extended to biometric/hardware.
 */

let lastAuthTime = 0;
const AUTH_VALIDITY_MS = 30_000; // 30 seconds

/**
 * Check if user has recently authenticated (within validity window).
 */
export function isRecentlyAuthenticated(): boolean {
  return Date.now() - lastAuthTime < AUTH_VALIDITY_MS;
}

/**
 * Request user authentication for reveal operation.
 * Returns true if authenticated, false otherwise.
 */
export async function requestAuthentication(): Promise<boolean> {
  // If recently authenticated, skip re-auth
  if (isRecentlyAuthenticated()) {
    return true;
  }
  
  // Simple password confirmation for now
  // In production, this would integrate with wallet unlock mechanism
  const confirmed = window.confirm(
    'Reveal sensitive information?\n\nThis will temporarily display hidden amounts. Click OK to confirm.'
  );
  
  if (confirmed) {
    lastAuthTime = Date.now();
    return true;
  }
  
  return false;
}

/**
 * Clear authentication state (logout, wallet lock, etc).
 */
export function clearAuthentication(): void {
  lastAuthTime = 0;
}

/**
 * Extend auth validity (user performed another authenticated action).
 */
export function extendAuthValidity(): void {
  if (isRecentlyAuthenticated()) {
    lastAuthTime = Date.now();
  }
}
