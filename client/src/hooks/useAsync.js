import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Generic hook for handling async operations
 * Manages loading, error, and data states
 *
 * @param {Function} asyncFunction - The async function to execute
 * @param {boolean} immediate - Whether to execute immediately on mount
 * @returns {Object} { execute, loading, error, data, reset }
 *
 * @example
 * const { execute, loading, error, data } = useAsync(
 *   () => notesAPI.getAll(),
 *   true // execute immediately
 * );
 */
export function useAsync(asyncFunction, immediate = true) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Track if component is mounted to prevent state updates after unmount
  const mountedRef = useRef(true);

  // Memoize the async function execution
  const execute = useCallback(
    async (...params) => {
      setLoading(true);
      setError(null);

      try {
        const response = await asyncFunction(...params);

        // Only update state if component is still mounted
        if (mountedRef.current) {
          setData(response);
          setLoading(false);
          return response;
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err.message || 'An error occurred');
          setLoading(false);
        }
        throw err;
      }
    },
    [asyncFunction]
  );

  // Reset all states
  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setData(null);
  }, []);

  // Execute immediately if requested
  useEffect(() => {
    if (immediate) {
      execute();
    }

    // Cleanup: mark component as unmounted
    return () => {
      mountedRef.current = false;
    };
  }, [execute, immediate]);

  return { execute, loading, error, data, reset };
}

export default useAsync;
