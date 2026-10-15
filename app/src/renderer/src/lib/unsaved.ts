import { useEffect } from 'react';
import { useApp } from '../store/app';

/** Marks a form with unsaved edits, so leaving the page or closing the app asks first. */
export function useUnsaved(key: string, label: string, dirty: boolean): void {
  const setUnsaved = useApp((s) => s.setUnsaved);
  useEffect(() => {
    setUnsaved(key, dirty ? label : null);
    return () => setUnsaved(key, null);
  }, [key, label, dirty, setUnsaved]);
}
