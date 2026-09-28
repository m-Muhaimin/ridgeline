'use client';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useData } from '../../../components/DataProvider';
import { OrganizationSettingsPanel } from '../../../components/OrganizationSettingsPanel';
import type { SettingsSubTab } from '../../../types';

// The `tab` query param is user input: an unknown value falls back to the same
// default a bare `/settings` gets, rather than rendering a panel that does not
// exist.
const VALID: SettingsSubTab[] = ['general', 'rates', 'ai_dispatcher', 'billing'];

/**
 * `/settings?tab=general|ai_dispatcher|rates|billing` - the URL is the source of
 * truth for which sub-tab is showing, so this page is deep-linkable and the back
 * button works. `App.tsx` had this as `settingsSubTab` state with no URL at all.
 */
function SettingsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const raw = searchParams.get('tab');
  const tab: SettingsSubTab = (VALID.includes(raw as SettingsSubTab) ? raw : 'general') as SettingsSubTab;
  const { settingsSubTab, setSettingsSubTab } = useData();
  // One-way: the URL decides, the provider is told. Writing only to the
  // provider means no navigation and no loop - the effect no-ops once the two
  // agree. This is what keeps the sidebar highlight correct on a deep link or on
  // back/forward, since AppSidebar and Header both read `settingsSubTab`.
  useEffect(() => { if (settingsSubTab !== tab) setSettingsSubTab(tab); }, [tab, settingsSubTab, setSettingsSubTab]);
  return (
    <OrganizationSettingsPanel
      tab={tab}
      onTabChange={(next) => { setSettingsSubTab(next); router.replace(`/settings?tab=${next}`, { scroll: false }); }}
    />
  );
}

export default function SettingsPage() {
  return <Suspense fallback={null}><SettingsInner /></Suspense>;
}
