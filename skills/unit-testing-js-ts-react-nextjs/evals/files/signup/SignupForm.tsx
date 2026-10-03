'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!EMAIL_RE.test(email)) return setError('Enter a valid email address');
    if (password.length < 8) return setError('Password must be at least 8 characters');

    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.status === 409) return setError('An account with this email already exists');
      if (!res.ok) return setError('Something went wrong. Please try again.');
      router.push('/welcome');
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />

      <label htmlFor="password">Password</label>
      <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />

      {error && <p role="alert">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
