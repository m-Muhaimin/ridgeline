'use client';
import { useState } from 'react';
import { useData } from '../../../components/DataProvider';
import { SmsInbox } from '../../../components/SmsInbox';
import { SimulateSmsModal } from '../../../components/SimulateSmsModal';

export default function SmsPage() {
  const {
    threads, selectedThreadId, selectThread, handleSendMessage, handleProcessCustomerSms,
    bookings, settings, services, handleAutoConfirmFromSms, tradespersonStatus,
    setTradespersonStatus, currentUser, handleToggleTakeover, handleSendTestSms,
  } = useData();
  const [isSimulateOpen, setSimulateOpen] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setSimulateOpen(true)} className="text-xs font-medium text-neutral-600 hover:text-neutral-900 cursor-pointer">Simulate SMS</button>
      </div>
      <SmsInbox
        threads={threads}
        activeThreadId={selectedThreadId}
        onSelectThread={selectThread}
        onSendMessage={handleSendMessage}
        onProcessCustomerSms={handleProcessCustomerSms}
        bookings={bookings}
        settings={settings}
        services={services}
        onAutoConfirmFromSms={handleAutoConfirmFromSms}
        tradespersonStatus={tradespersonStatus}
        setTradespersonStatus={setTradespersonStatus}
        user={currentUser}
        onToggleTakeover={handleToggleTakeover}
      />
      <SimulateSmsModal isOpen={isSimulateOpen} onClose={() => setSimulateOpen(false)} onSendTestSms={handleSendTestSms} settings={settings} />
    </div>
  );
}
