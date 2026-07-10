import { useState, useEffect, useRef } from 'react';

export function usePolling(fetcher, intervalMs = 2000, active = true) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    let isMounted = true;
    let inFlight = false;

    async function load() {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const result = await fetcher();
        if (isMounted) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (isMounted) setError(err.message);
      } finally {
        inFlight = false;
      }
    }

    load();
    if (active) timer.current = setInterval(load, intervalMs);

    return () => {
      isMounted = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [fetcher, intervalMs, active]);

  return { data, error };
}
