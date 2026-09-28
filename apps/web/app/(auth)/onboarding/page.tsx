'use client';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../../../lib/apiFetch';
import { User, Organization, AssistantSettings, TradeService } from '../../../types';
import { OnboardingPage } from '../../../components/OnboardingPage';

// Local stand-in for App.tsx's ProtectedRoute + toast pair. `(dashboard)` is not
// a parent of /onboarding, so this page owns its own session check.
export default function OnboardingRoute() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  useEffect(() => {
    async function checkAuth() {
      setIsLoading(true);
      try {
        const data = await apiFetch('/api/auth/me');
        if (data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      } catch (e) {
        console.warn('Auth check skipped:', e);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    checkAuth();
  }, []);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/auth');
    }
  }, [isLoading, user, router]);

  // App.tsx handleOnboardingComplete, minus the DataProvider state it does not
  // have here: the success toast and the redirect to the dashboard.
  const handleComplete = (
    newOrg: Organization,
    _newSettings: AssistantSettings,
    _newServices: TradeService[],
  ) => {
    showToast(`Setup complete! Dispatch engine online for ${newOrg.name}.`);
    router.push('/');
    router.refresh();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 border-4 border-neutral-200 border-t-neutral-900 rounded-full animate-spin" />
          <p className="text-sm font-medium text-neutral-500">Securing your session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <>
      {/* Toast alert banner */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs text-white shadow-xl border border-neutral-700 animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      <OnboardingPage user={user} onComplete={handleComplete} showToast={showToast} />
    </>
  );
}
