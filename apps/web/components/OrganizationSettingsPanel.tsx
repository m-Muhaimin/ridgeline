'use client';
import { useRouter } from 'next/navigation';
import { useData } from './DataProvider';
import { OrganizationSettings } from './OrganizationSettings';
import type { SettingsSubTab } from '../types';

/**
 * The one prop-wiring for both settings routes.
 *
 * `App.tsx:920-990` rendered `OrganizationSettings` inline under
 * `(activeTab === 'settings' || activeTab === 'services')`, passing the org /
 * settings / services state and their mutators straight from App.tsx's own
 * state. Those live in `useData()` now, so this is the one-to-one mapping: same
 * panel, same props, both URLs. `App.tsx:985`'s
 * `activeSubTab={activeTab === 'services' ? 'rates' : settingsSubTab}` becomes
 * the `tab` prop, decided by the route (see the two page files).
 */
export function OrganizationSettingsPanel({ tab, onTabChange }: {
  tab: SettingsSubTab;
  onTabChange: (tab: SettingsSubTab) => void;
}) {
  const router = useRouter();
  const { currentOrg, handleUpdateOrg, settings, handleUpdateSettings, services,
          handleAddService, handleDeleteService, showToast, handleLogout, setSettingsSubTab } = useData();
  return (
    <OrganizationSettings
      currentOrg={currentOrg}
      onUpdateOrg={handleUpdateOrg}
      settings={settings}
      onUpdateSettings={handleUpdateSettings}
      services={services}
      onAddService={handleAddService}
      onDeleteService={handleDeleteService}
      activeSubTab={tab}
      onChangeSubTab={onTabChange}
      showToast={showToast}
      onOpenOnboarding={() => router.push('/onboarding')}
      onLogout={handleLogout}
    />
  );
}
