import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { SidebarProvider, SidebarInset } from './ui/sidebar';
import { AppSidebar } from './AppSidebar';
import { Header } from './Header';
import { NewBookingModal } from './NewBookingModal';
import { useData } from './DataProvider';

/**
 * Port of the chrome half of `src/App.tsx` (590-1029) with the tab sections
 * removed - those become the route pages in tasks 4-9.
 *
 * It also carries the route guard that used to be `ProtectedRoute` (47-70).
 * Two behavioural notes, both intentional:
 *  - the redirect is an effect plus `null`, not a render-time Navigate, so no
 *    shell markup is ever produced for an unauthenticated request;
 *  - there is no `state.from`. `/onboarding` lives outside this layout, so the
 *    pathname check in ProtectedRoute is unnecessary, and post-login landing on
 *    `/` is what the app already did.
 */
export const DashboardShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const {
    currentUser,
    isAuthLoading,
    isDataLoading,
    organizations,
    currentOrg,
    bookings,
    threads,
    missedCalls,
    services,
    settings,
    tradespersonStatus,
    setTradespersonStatus,
    neonConnected,
    neonLatency,
    unreadSmsCount,
    unconvertedCallsCount,
    isNewBookingOpen,
    setIsNewBookingOpen,
    toastMessage,
    showToast,
    settingsSubTab,
    setSettingsSubTab,
    syncFromNeon,
    handleLogout,
    handleSelectOrg,
    handleAddOrg,
    handleAddBooking,
  } = useData();

  useEffect(() => {
    if (isAuthLoading) return;
    if (!currentUser) {
      router.replace('/auth');
      return;
    }
    if (!currentUser.onboardingCompleted) {
      router.replace('/onboarding');
    }
  }, [isAuthLoading, currentUser, router]);

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 border-4 border-neutral-200 border-t-neutral-900 rounded-full animate-spin" />
          <p className="text-sm font-medium text-neutral-500">Securing your session...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  if (!currentUser.onboardingCompleted) {
    return null;
  }

  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-screen w-full bg-neutral-50/70 text-neutral-900 font-sans">

        {/* Toast alert banner */}
        {toastMessage && (
          <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs text-white shadow-xl border border-neutral-700 animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Canonical shadcn Sidebar Navigation */}
        <AppSidebar
          settingsSubTab={settingsSubTab}
          setSettingsSubTab={setSettingsSubTab}
          settings={settings}
          organizations={organizations}
          currentOrg={currentOrg}
          onSelectOrg={handleSelectOrg}
          onAddOrg={handleAddOrg}
          unreadSmsCount={unreadSmsCount}
          unconvertedCallsCount={unconvertedCallsCount}
          totalBookingsCount={bookings.length}
          onOpenNewBooking={() => setIsNewBookingOpen(true)}
          tradespersonStatus={tradespersonStatus}
          setTradespersonStatus={setTradespersonStatus}
          user={currentUser}
          onLogout={handleLogout}
          onOpenOnboarding={() => router.push('/onboarding')}
        />

        {/* Sidebar Inset: Header + Main Content Area */}
        <SidebarInset className="flex flex-col flex-1 overflow-x-hidden min-w-0">

          <Header
            settingsSubTab={settingsSubTab}
            settings={settings}
            unreadSmsCount={unreadSmsCount}
            unconvertedCallsCount={unconvertedCallsCount}
            onOpenNewBooking={() => setIsNewBookingOpen(true)}
            neonConnected={neonConnected}
            neonLatency={neonLatency}
            user={currentUser}
            onLogout={handleLogout}
            isDataLoading={isDataLoading}
            onRefreshData={() => {
              showToast('Syncing live data from database...');
              syncFromNeon(true);
            }}
          />

          <main className="flex-1 p-3 sm:p-5 md:p-6 lg:p-8 max-w-7xl w-full mx-auto min-w-0">
            {children}
          </main>

        </SidebarInset>

        {/* Modals */}
        <NewBookingModal
          isOpen={isNewBookingOpen}
          timeZone={currentOrg?.timezone || 'UTC'}
          onClose={() => setIsNewBookingOpen(false)}
          onAddBooking={handleAddBooking}
          services={services}
        />

      </div>
    </SidebarProvider>
  );
};
