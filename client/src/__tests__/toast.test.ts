import { describe, expect, it } from 'vitest';
import { toast, useToastStore } from '../store/toast';

function reset() {
  useToastStore.setState({ toasts: [] });
}

describe('toast store', () => {
  it('pushes typed toasts and dismisses them by id', () => {
    reset();
    toast.success('Saved');
    toast.error('Failed');

    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(2);
    expect(toasts[0]).toMatchObject({ kind: 'success', message: 'Saved' });
    expect(toasts[1]).toMatchObject({ kind: 'error', message: 'Failed' });

    useToastStore.getState().dismiss(toasts[0].id);
    const after = useToastStore.getState().toasts;
    expect(after).toHaveLength(1);
    expect(after[0].message).toBe('Failed');
  });

  it('keeps toasts in insertion order', () => {
    reset();
    toast.info('one');
    toast.info('two');
    const messages = useToastStore.getState().toasts.map((t) => t.message);
    expect(messages).toEqual(['one', 'two']);
    reset();
  });
});