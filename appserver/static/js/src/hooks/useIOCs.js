/**
 * hooks/useIOCs.js
 * Stateful hook managing the IOC list view: filters, pagination, selection,
 * and server interactions. Keeps IOCTable and BulkActionBar in sync.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import api from '../api/api';

const DEFAULT_FILTERS = {
  type:           '',
  list_type:      '',
  status:         'active',
  policy:         '',
  search:         '',
  conflict_state: '',
  source:         '',
  expiry_warning: '',
  has_hits:       '',
  zero_hits:      '',
  sort_field:     'created_at',
  sort_dir:       'desc',
};

export default function useIOCs({ pageSize = 50 } = {}) {
  const [iocs,          setIOCs]          = useState([]);
  const [totalCount,    setTotalCount]    = useState(0);
  const [totalPages,    setTotalPages]    = useState(1);
  const [page,          setPage]          = useState(1);
  const [filters,       setFilters]       = useState(DEFAULT_FILTERS);
  const [selected,      setSelected]      = useState(new Set());
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [initialized,   setInitialized]   = useState(false);

  const abortRef = useRef(null);

  const fetchIOCs = useCallback(async (overrideFilters, overridePage) => {
    if (abortRef.current) abortRef.current = false;
    const token = {};
    abortRef.current = token;

    setLoading(true);
    setError(null);

    const params = {
      ...DEFAULT_FILTERS,
      ...(overrideFilters ?? filters),
      page:      overridePage ?? page,
      page_size: pageSize,
    };

    // Strip empty params
    Object.keys(params).forEach(k => {
      if (params[k] === '' || params[k] === null || params[k] === undefined)
        delete params[k];
    });

    const res = await api.iocs.list(params);

    if (token !== abortRef.current) return; // stale

    if (res.error) {
      setError(res.error);
    } else {
      setIOCs(res.data?.items || []);
      setTotalCount(res.data?.total_count || 0);
      setTotalPages(res.data?.total_pages || 1);
      setInitialized(true);
    }
    setLoading(false);
  }, [filters, page, pageSize]);

  useEffect(() => { fetchIOCs(); }, [fetchIOCs]);

  const updateFilter = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
    setSelected(new Set());
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
    setSelected(new Set());
  }, []);

  const toggleSelect = useCallback((key) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(iocs.map(i => i._key)));
  }, [iocs]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const deleteIOC = useCallback(async (key) => {
    const res = await api.iocs.delete(key);
    if (!res.error) fetchIOCs();
    return res;
  }, [fetchIOCs]);

  const bulkAction = useCallback(async (action, extra = {}) => {
    const res = await api.iocs.bulk(action, [...selected], extra);
    if (!res.error) { setSelected(new Set()); fetchIOCs(); }
    return res;
  }, [selected, fetchIOCs]);

  const createIOC = useCallback(async (data) => {
    const res = await api.iocs.create(data);
    if (!res.error) fetchIOCs();
    return res;
  }, [fetchIOCs]);

  const updateIOC = useCallback(async (key, data) => {
    const res = await api.iocs.update(key, data);
    if (!res.error) fetchIOCs();
    return res;
  }, [fetchIOCs]);

  return {
    iocs, totalCount, totalPages, page, setPage,
    filters, updateFilter, resetFilters,
    selected, toggleSelect, selectAll, clearSelection,
    loading, error, initialized,
    deleteIOC, bulkAction, createIOC, updateIOC,
    refresh: fetchIOCs,
  };
}
