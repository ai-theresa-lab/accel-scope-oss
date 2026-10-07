// ledgerGate.ts — may this run's findings be merged into the per-org findings ledger?
//
// WHY. finishRun merged EVERY completed run's findings into the ledger (memory.ts mergeLedger) — an undisclosed
// memory WRITE, even with the run's "Draft memory from reports" tick OFF (a real run: learned.saved.added = 53 on a
// run whose user had not opted in to writing memory). The ledger is durable, cross-run org knowledge that primes
// later runs, so it is a memory write like any other: it now rides the SAME per-run opt-in (`run.writeMemory`,
// default OFF) instead of being unconditional, and a skip is logged so the run discloses what it did not write.
// PURE (unit-tested); finishRun calls it.
export function ledgerMergeDecision(run: { writeMemory?: boolean }, findingCount: number): { merge: boolean; log?: string } {
  if (run.writeMemory === true) return { merge: true };
  return {
    merge: false,
    log: `findings ledger: not updated — this run did not opt in to writing memory ("Save learnings to org memory" off)${findingCount ? `; ${findingCount} finding(s) not recorded` : ''}`,
  };
}
