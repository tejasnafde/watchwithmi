'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

/** Flips <html data-theme> and remembers the choice. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  // null until mounted: the server cannot know what the inline script picked,
  // so rendering an icon during SSR guarantees a hydration mismatch.
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null);

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'light' ? 'light' : 'dark');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // private mode cannot persist; the toggle still works for this view
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      className={`inline-flex h-11 w-11 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${className}`}
    >
      {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
