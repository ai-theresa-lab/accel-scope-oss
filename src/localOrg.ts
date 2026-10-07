// The single-user app has exactly one workspace. Code that is keyed by tenant / org (run records, the incremental
// re-scan lineage index, org findings, cross-project facts, org memory) uses these constants, so all of it lives under
// one stable key in the data dir.

export const LOCAL_TENANT = 'local';
export const LOCAL_ORG_ID = 'local';

/** The org a tenant's runs belong to — always the one local workspace. */
export function orgIdForTenant(_tenant?: string): string { return LOCAL_ORG_ID; }
