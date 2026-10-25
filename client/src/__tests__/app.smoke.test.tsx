import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../App';

/** Renders the real app tree at a path and exposes the current location. */
function Probe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Probe />
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('app routes (smoke)', () => {
  it('renders the login route with its form shell', () => {
    renderAt('/login');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByPlaceholderText('you@company.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('••••••••')).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /create one/i })).toBeTruthy();
    expect(screen.getByTestId('path').textContent).toBe('/login');
  });

  it('redirects unknown routes to the landing page', () => {
    renderAt('/definitely-not-a-page');
    expect(screen.getByTestId('path').textContent).toBe('/');
  });

  it('redirects unauthenticated visitors away from the app shell', () => {
    renderAt('/app');
    // No session in jsdom → RequireAuth must bounce to /login.
    expect(screen.getByTestId('path').textContent).toBe('/login');
  });
});