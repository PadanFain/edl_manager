/**
 * hooks/useAsync.js
 * Generic hook for tracking async operation state (loading / data / error).
 */
import { useState, useCallback, useRef } from 'react';

export function useAsync(asyncFn) {
  const [loading, setLoading] = useState(false);
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState(null);
  const mountedRef = useRef(true);

  const execute = useCallback(async (...args) => {
    setLoading(true);
    setError(null);
    try {
      const result = await asyncFn(...args);
      if (mountedRef.current) {
        if (result.error) { setError(result.error); setData(null); }
        else               { setData(result.data); }
      }
      return result;
    } catch (err) {
      if (mountedRef.current) setError(err.message || 'Unknown error');
      return { data: null, error: err.message };
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [asyncFn]);

  const reset = useCallback(() => {
    setLoading(false); setData(null); setError(null);
  }, []);

  return { execute, loading, data, error, reset };
}
