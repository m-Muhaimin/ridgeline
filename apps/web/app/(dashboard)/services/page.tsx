'use client';
import { useRouter } from 'next/navigation';
import { useData } from '../../../components/DataProvider';
import { OrganizationSettingsPanel } from '../../../components/OrganizationSettingsPanel';

/**
 * `/services` is the rates tab of the same settings surface
 * (`App.tsx:985` - `activeSubTab={activeTab === 'services' ? 'rates' : ...}`).
 *
 * Clicking a different sub-tab here has to leave the route, because the URL is
 * the sub-tab: `rates` stays on `/services`, anything else goes to
 * `/settings?tab=...`. `setSettingsSubTab` keeps the sidebar highlight in step
 * (AppSidebar reads it, not the query string).
 *
 * No `useSearchParams` here, so `/services` stays statically prerenderable.
 */
export default function ServicesPage() {
  const router = useRouter();
  const { setSettingsSubTab } = useData();
  return (
    <OrganizationSettingsPanel
      tab="rates"
      onTabChange={(tab) => {
        setSettingsSubTab(tab);
        router.push(tab === 'rates' ? '/services' : `/settings?tab=${tab}`);
      }}
    />
  );
}
