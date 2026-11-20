import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';

/**
 * Shared query cache for one page. Each portal is its own HTML document with
 * its own cache, so no data leaks between portals in memory.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } }
});

export function mount(page: ReactElement): void {
  const el = document.getElementById('root');
  if (!el) throw new Error('Missing #root element');
  createRoot(el).render(
    <QueryClientProvider client={queryClient}>{page}</QueryClientProvider>
  );
}
