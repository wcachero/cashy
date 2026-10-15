export type ThemeMode = 'dark' | 'light';

export const THEME_KEY = 'cashy_theme';

export function readStoredTheme(): ThemeMode {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset['theme'] = mode;
  document.documentElement.style.colorScheme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'light' ? '#f4f7fb' : '#07111f');
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Private browsing can block storage. The choice still applies for this page.
  }
}
