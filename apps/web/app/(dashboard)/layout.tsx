'use client';
import { DataProvider } from '../../components/DataProvider';
import { DashboardShell } from '../../components/DashboardShell';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DataProvider><DashboardShell>{children}</DashboardShell></DataProvider>;
}
