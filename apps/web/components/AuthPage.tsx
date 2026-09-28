import React, { useState } from 'react';
import { 
  Mail, 
  Lock, 
  User as UserIcon, 
  Wrench, 
  ArrowRight, 
  Eye, 
  EyeOff, 
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { TradeType } from '../types';
import { RidgeLineLogo } from './RidgeLineLogo';
import { AIIcon } from './AIIcon';
import { apiFetch } from '../lib/apiFetch';

// Ported from src/pages/AuthPage.tsx. In apps/web there is no App.tsx provider on
// /auth, so `onAuthSuccess` / `currentUser` / `showToast` are gone: navigation is
// local (`router.push`) and the toast is local state. The "already signed in"
// redirect that used to live here now belongs to the (dashboard) layout.
export const AuthPage: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = (searchParams.get('mode') as 'login' | 'register') || 'login';

  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [trade, setTrade] = useState<TradeType>('plumbing');
  const [showPassword, setShowPassword] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Local stand-in for App.tsx's showToast / toastMessage pair.
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = mode === 'login' 
        ? { email, password }
        : { email, password, fullName, trade };

      const data = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!data.success) {
        throw new Error(data.error || 'Authentication failed');
      }

      showToast(mode === 'login' ? `Welcome back, ${data.user.fullName}!` : `Account created! Welcome to RidgeLine.`);
      router.push(data.user.onboardingCompleted ? '/' : '/onboarding');
    } catch (err: any) {
      setErrorMessage(err.message || 'Authentication error. Please verify your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemo = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: 'mark@apexplumbingpro.com', password: 'Password123!' }),
      });
      if (data.success && data.user) {
        showToast('Logged in as Mark Kowalski (Demo Account)');
        router.push(data.user.onboardingCompleted ? '/' : '/onboarding');
      } else {
        throw new Error(data.error);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Demo login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl border border-neutral-200 relative">
        {/* Toast alert banner */}
        {toastMessage && (
          <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs text-white shadow-xl border border-neutral-700 animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4 cursor-pointer" onClick={() => router.push('/')}>
            <RidgeLineLogo size={48} />
          </div>
          <h2 className="text-2xl font-bold text-neutral-900 font-head">
            {mode === 'login' ? 'Sign in to RidgeLine' : 'Create your Trade Account'}
          </h2>
          <p className="text-sm text-neutral-500 mt-2">
            {mode === 'login' 
              ? 'Autonomous AI dispatch & scheduling for solo tradespeople'
              : 'Start converting missed calls and SMS inquiries into booked jobs'}
          </p>
          <div className="flex items-center justify-center gap-1.5 mt-3 text-xs text-neutral-500 font-medium">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span>Encrypted Contractor Account</span>
          </div>
        </div>

        {/* Tab Toggle */}
        <div className="flex rounded-lg bg-neutral-100 p-1 mb-6">
          <button
            type="button"
            onClick={() => { setMode('login'); setErrorMessage(null); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all cursor-pointer ${
              mode === 'login' 
                ? 'bg-white text-neutral-900 shadow-sm' 
                : 'text-neutral-500 hover:text-neutral-900'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setErrorMessage(null); }}
            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all cursor-pointer ${
              mode === 'register' 
                ? 'bg-white text-neutral-900 shadow-sm' 
                : 'text-neutral-500 hover:text-neutral-900'
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
            <span className="font-semibold text-red-900 shrink-0">Error:</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                  Full Name / Owner Name
                </label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="e.g. Mark Kowalski"
                    className="w-full rounded-lg border border-neutral-300 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
                  Trade Specialization
                </label>
                <div className="relative">
                  <Wrench className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                  <select
                    value={trade}
                    onChange={e => setTrade(e.target.value as TradeType)}
                    className="w-full rounded-lg border border-neutral-300 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 bg-white"
                  >
                    <option value="plumbing">Plumbing &amp; Drains</option>
                    <option value="electrical">Electrical &amp; Lighting</option>
                    <option value="hvac">HVAC &amp; Mechanical</option>
                    <option value="locksmith">Locksmith Services</option>
                    <option value="general">General Contracting &amp; Handyman</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-neutral-700 mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="mark@apexplumbingpro.com"
                className="w-full rounded-lg border border-neutral-300 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-neutral-700">
                Password
              </label>
              {mode === 'login' && (
                <span className="text-[10px] text-neutral-400">
                  Min. 6 characters
                </span>
              )}
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-neutral-300 py-2.5 pl-9 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-neutral-400 hover:text-neutral-700 cursor-pointer"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-4 py-3 px-4 rounded-lg bg-neutral-900 text-white font-semibold text-sm hover:bg-neutral-800 transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70"
          >
            <span>{isLoading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account & Continue'}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        {/* Quick Demo Login Option */}
        <div className="mt-6 pt-6 border-t border-neutral-100">
          <button
            type="button"
            onClick={handleQuickDemo}
            disabled={isLoading}
            className="w-full py-2.5 px-4 rounded-lg border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-800 text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <AIIcon className="h-4 w-4 text-indigo-600" />
            <span>One-Click Demo Login (Mark Kowalski)</span>
          </button>
          <p className="text-[10px] text-center text-neutral-400 mt-3 uppercase tracking-wider font-bold">
            Demo Environment Only
          </p>
        </div>

        <div className="mt-8 text-center">
          <button 
            onClick={() => router.push('/')}
            className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
          >
            ← Back to RidgeLine Home
          </button>
        </div>
      </div>
    </div>
  );
};
