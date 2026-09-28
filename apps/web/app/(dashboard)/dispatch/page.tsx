'use client';
import { useData } from '../../../components/DataProvider';
import { DispatchBoard } from '../../../components/DispatchBoard';

export default function DispatchPage() {
  const { bookings, isDataLoading, handleUpdateStatus, handleSendEtaSms, openThread, setIsNewBookingOpen } = useData();
  return (
    <DispatchBoard
      bookings={bookings}
      onUpdateStatus={handleUpdateStatus}
      onSendEtaSms={handleSendEtaSms}
      onOpenThread={(threadId) => { if (threadId) openThread(threadId); }}
      onOpenNewBooking={() => setIsNewBookingOpen(true)}
      isLoading={isDataLoading}
    />
  );
}
