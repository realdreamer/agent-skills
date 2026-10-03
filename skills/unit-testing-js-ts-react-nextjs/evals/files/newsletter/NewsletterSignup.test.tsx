import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewsletterSignup } from './NewsletterSignup';
import * as validation from './validation';

vi.mock('./analytics', () => ({ track: vi.fn() }));

const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('NewsletterSignup', () => {
  it('renders', () => {
    const { container } = render(<NewsletterSignup listId="weekly" />);
    expect(container).toMatchSnapshot();
  });

  it('calls isValidEmail', () => {
    const spy = vi.spyOn(validation, 'isValidEmail');
    render(<NewsletterSignup listId="weekly" />);
    fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'ana@example.com' } });
    fireEvent.click(screen.getByTestId('subscribe-btn'));
    expect(spy).toHaveBeenCalledWith('ana@example.com');
  });

  it('works', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    render(<NewsletterSignup listId="weekly" />);
    fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'ana@example.com' } });
    fireEvent.click(screen.getByTestId('subscribe-btn'));
    await new Promise((r) => setTimeout(r, 500));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows error', async () => {
    vi.spyOn(validation, 'isValidEmail').mockReturnValue(false);
    render(<NewsletterSignup listId="weekly" />);
    await waitFor(() => {
      fireEvent.click(screen.getByTestId('subscribe-btn'));
      expect(document.querySelector('.error')).not.toBeNull();
    });
  });

  it('handles server failure', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    render(<NewsletterSignup listId="weekly" />);
    fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'ana@example.com' } });
    fireEvent.click(screen.getByTestId('subscribe-btn'));
  });

  it('button disabled', () => {
    render(<NewsletterSignup listId="weekly" />);
    const button = screen.getByTestId('subscribe-btn') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
});
