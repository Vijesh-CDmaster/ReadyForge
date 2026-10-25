import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Dropdown, Modal } from '../components/ui';
import { ErrorBoundary } from '../components/ErrorBoundary';

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Test dialog">
        <button type="button">Inner action</button>
      </Modal>
    </div>
  );
}

function DropdownHarness() {
  const [chosen, setChosen] = useState('');
  return (
    <div>
      <Dropdown
        label="Test menu"
        triggerClassName="trigger"
        render={(close) => (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setChosen('picked');
              close();
            }}
          >
            Item A
          </button>
        )}
      >
        Menu trigger
      </Dropdown>
      <span data-testid="chosen">{chosen}</span>
      <button type="button">Outside</button>
    </div>
  );
}

describe('Modal accessibility', () => {
  it('exposes a labelled modal dialog, moves focus in, and locks body scroll', () => {
    render(<ModalHarness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Test dialog' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on Escape, restores focus to the opener, and unlocks scrolling', () => {
    render(<ModalHarness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(opener);
  });

  it('closes when the backdrop itself is clicked', () => {
    const { container } = render(<ModalHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const backdrop = container.ownerDocument.querySelector('[role="presentation"]') as HTMLElement;
    expect(backdrop).toBeTruthy();
    fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Dropdown accessibility', () => {
  it('toggles aria-expanded and exposes a named menu', () => {
    render(<DropdownHarness />);
    const trigger = screen.getByRole('button', { name: 'Menu trigger' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Test menu' })).toBeTruthy();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    render(<DropdownHarness />);
    const trigger = screen.getByRole('button', { name: 'Menu trigger' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when clicking outside the menu', () => {
    render(<DropdownHarness />);
    const trigger = screen.getByRole('button', { name: 'Menu trigger' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('runs the item action and closes the menu', () => {
    render(<DropdownHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Menu trigger' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Item A' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByTestId('chosen').textContent).toBe('picked');
  });
});

describe('ErrorBoundary', () => {
  it('shows a recovery screen instead of crashing the tree', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    function Boom(): never {
      throw new Error('kaboom');
    }

    render(
      <ErrorBoundary area="test page">
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Something broke in test page/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(consoleSpy).toHaveBeenCalled();
  });
});