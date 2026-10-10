import { useCallback, useEffect, useState } from "react";
import { MAX_SAVED_FILTERS, readSavedFilters, ruleIsEmpty, sanitizeRule, writeSavedFilters, type SavedFilter, type SavedRule } from "../lib/savedFilters";

/** The user's saved smart filters (name + rule), stored on this device. */
export function useSavedFilters() {
  const [filters, setFilters] = useState<SavedFilter[]>(readSavedFilters);
  useEffect(() => { writeSavedFilters(filters); }, [filters]);

  const create = useCallback((name: string, rule: SavedRule): SavedFilter | null => {
    const clean = sanitizeRule(rule);
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed || ruleIsEmpty(clean)) return null;
    const made: SavedFilter = { id: `sf-${crypto.randomUUID()}`, name: trimmed, rule: clean };
    let added = false;
    setFilters((current) => { if (current.length >= MAX_SAVED_FILTERS) return current; added = true; return [...current, made]; });
    return added ? made : null;
  }, []);
  const update = useCallback((id: string, name: string, rule: SavedRule) => {
    const clean = sanitizeRule(rule);
    const trimmed = name.trim().slice(0, 40);
    if (trimmed && !ruleIsEmpty(clean)) setFilters((current) => current.map((item) => (item.id === id ? { ...item, name: trimmed, rule: clean } : item)));
  }, []);
  const remove = useCallback((id: string) => setFilters((current) => current.filter((item) => item.id !== id)), []);
  const replace = useCallback((next: SavedFilter[]) => setFilters(next), []);
  return { filters, create, update, remove, replace };
}
export type SavedFiltersState = ReturnType<typeof useSavedFilters>;
