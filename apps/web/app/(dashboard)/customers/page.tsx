'use client';
import { useData } from '../../../components/DataProvider';
import { CustomersView } from '../../../components/CustomersView';

export default function CustomersPage() {
  const { customers, bookings, isDataLoading } = useData();
  return <CustomersView customers={customers} bookings={bookings} isLoading={isDataLoading} />;
}
