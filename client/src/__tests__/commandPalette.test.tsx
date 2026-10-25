import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CommandPalette } from '../components/CommandPalette';

function Probe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

const PROJECT_ID = '6add8136e9a12200939e2a25';

function renderPalette(overrides?: { activeWs?: string; projectId?: string }) {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={['/app']}>
      <Probe />
      <CommandPalette
        open
        onClose={onClose}
        activeWs={overrides?.activeWs ?? 'ws1'}
        projectId={overrides?.projectId ?? PROJECT_ID}
        projectTitle="Demo project"
      />
    </MemoryRouter>
  );
  return { onClose };
}

describe('command palette', () => {
  it('opens with focus in the search input and lists real destinations', async () => {
    renderPalette();
    const input = screen.getByRole('combobox', { name: /search pages and actions/i });
    await waitFor(() => expect(document.activeElement).toBe(input));

    // Core commands exist...
    expect(screen.getByRole('option', { name: /dashboard/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /new project/i })).toBeTruthy();
    // ...and so do workspace-scoped ones when a workspace is active.
    expect(screen.getByRole('option', { name: /analytics/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /workspace settings/i })).toBeTruthy();
    // Project tabs are listed with the project as context.
    expect(screen.getByRole('option', { name: /cost at risk/i })).toBeTruthy();
  });

  it('filters as you type and navigates on Enter', () => {
    const { onClose } = renderPalette();
    const input = screen.getByRole('combobox', { name: /search pages and actions/i });

    fireEvent.change(input, { target: { value: 'cost' } });
    expect(screen.getByRole('option', { name: /cost at risk/i })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /dashboard/i })).toBeNull();

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('path').textContent).toBe(`/app/projects/${PROJECT_ID}/risk`);
  });

  it('shows an honest empty state for no matches', () => {
    renderPalette();
    const input = screen.getByRole('combobox', { name: /search pages and actions/i });
    fireEvent.change(input, { target: { value: 'zzzz-no-such-page' } });
    expect(screen.getByText(/No matches for/i)).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('closes on Escape without navigating', () => {
    const { onClose } = renderPalette();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId('path').textContent).toBe('/app');
  });

  it('omits workspace commands when no workspace is active', () => {
    renderPalette({ activeWs: '' });
    expect(screen.queryByRole('option', { name: /analytics/i })).toBeNull();
    expect(screen.queryByRole('option', { name: /workspace settings/i })).toBeNull();
    // Core navigation still available.
    expect(screen.getByRole('option', { name: /dashboard/i })).toBeTruthy();
  });
});