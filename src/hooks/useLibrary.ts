import { useCallback, useEffect, useRef, useState } from "react";
import { onLibraryChanged } from "../api";

/** Loads data with `load`, reloading when `deps` change or the backend reports a library change. */
export function useLibrary<T>(load: () => Promise<T>, deps: unknown[]): [T | undefined, () => void] {
  const [data, setData] = useState<T>();
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(() => {
    loadRef.current().then(setData).catch(console.error);
  }, []);

  useEffect(refresh, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const un = onLibraryChanged(refresh);
    return () => void un.then((f) => f());
  }, [refresh]);

  return [data, refresh];
}
