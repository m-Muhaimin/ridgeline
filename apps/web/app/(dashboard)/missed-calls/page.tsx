'use client';
import { useState } from 'react';
import { useData } from '../../../components/DataProvider';
import { apiFetch } from '../../../lib/apiFetch';
import { MissedCallsView } from '../../../components/MissedCallsView';
import { SimulateCallModal } from '../../../components/SimulateCallModal';

export default function MissedCallsPage() {
  const { missedCalls, bookings, isDataLoading, openThreadForPhone, settings, showToast, syncFromNeon } = useData();
  const [isSimulateOpen, setSimulateOpen] = useState(false);

  const handleSimulateMissedCall = async (
    callerName: string, callerPhone: string, voicemail: string,
    urgency: 'routine' | 'urgent' | 'emergency',
  ) => {
    try {
      const data = await apiFetch('/api/missed-call/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ callerName, callerPhone, voicemailTranscript: voicemail, settings }),
      });
      await syncFromNeon(true);
      showToast(`Auto-textback sent to ${callerName}: ${data.autoSms}`);
    } catch (err: any) {
      showToast(err?.message || 'Missed call simulation failed.');
    }
  };

  return (
    <div className="space-y-4">
      <MissedCallsView
        missedCalls={missedCalls}
        bookings={bookings}
        onOpenSimulateCall={() => setSimulateOpen(true)}
        onOpenThreadForCaller={openThreadForPhone}
        isLoading={isDataLoading}
      />
      <SimulateCallModal isOpen={isSimulateOpen} onClose={() => setSimulateOpen(false)} onSimulateMissedCall={handleSimulateMissedCall} />
    </div>
  );
}
