/*
   One tab per device runs the sync cycle (docs/device-sync-plan.md, WBS 6.6).
   A lease in localStorage — { id, until } — is renewed by its holder every few
   seconds and taken over once it lapses. Web Locks and BroadcastChannel are
   newer than Safari 12, so plain storage it is.
*/
export const LEASE_KEY = "rj.sync.lease";
export const LEASE_MS = 15000;

function read(storage) {
  try {
    const lease = JSON.parse(storage.getItem(LEASE_KEY));
    return lease && typeof lease.id === "string" && Number.isFinite(lease.until) ? lease : null;
  } catch {
    return null;
  }
}

// True when `tabId` holds the lease after this call (taking it if free or lapsed).
export function holdLease(storage, tabId, now) {
  const lease = read(storage);
  if (lease && lease.id !== tabId && lease.until > now) return false;
  try {
    storage.setItem(LEASE_KEY, JSON.stringify({ id: tabId, until: now + LEASE_MS }));
  } catch {
    return true; // storage unusable: nothing to race against
  }
  return true;
}

export function releaseLease(storage, tabId) {
  const lease = read(storage);
  if (lease && lease.id === tabId) {
    try {
      storage.removeItem(LEASE_KEY);
    } catch (_e) {
      // it lapses by itself within LEASE_MS.
    }
  }
}
