'use client';
import { Suspense } from 'react';
import { AuthPage } from '../../../components/AuthPage';

// The Suspense boundary is required: AuthPage uses useSearchParams(), and
// without a boundary `next build` fails with "useSearchParams() should be
// wrapped in a suspense boundary".
export default function AuthRoute() {
  return <Suspense fallback={null}><AuthPage /></Suspense>;
}
