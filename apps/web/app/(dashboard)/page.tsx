'use client';

import { useRouter } from 'next/navigation';
import {
  Calendar,
  MessageSquare,
  PhoneMissed,
  ArrowRight,
  CheckCircle2,
  Truck,
  AlertTriangle,
  MapPin,
  Plus
} from 'lucide-react';
import { useData } from '../../components/DataProvider';
import { CompletedBookingsChart } from '../../components/CompletedBookingsChart';
import { MetricCards } from '../../components/MetricCards';
import { formatCurrency } from '../../lib/utils';

/**
 * Port of the overview tab of `src/App.tsx` (650-854).
 *
 * The only structural change is navigation: `App.tsx` switched views with
 * `setActiveTab(...)`, and the URL is the view now, so those buttons push a
 * route. The data and the mutations are unchanged - they read out of
 * `useData()`, which owns what `App.tsx` held in its own state.
 */
export default function OverviewPage() {
  const {
    bookings,
    missedCalls,
    threads,
    settings,
    isDataLoading,
    unconvertedCallsCount,
    handleSendEtaSms,
    handleUpdateStatus,
    setIsNewBookingOpen,
    openThreadForPhone,
    currentOrg,
  } = useData();
  const router = useRouter();

  // "Today" is the shop's day, not UTC's. `toISOString()` would name tomorrow's
  // date for every western zone from 20:00 local until midnight, which is
  // exactly the window the last job of the day lands in. Same fix, and the same
  // helper shape, as NewBookingModal's date default.
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: currentOrg?.timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const todayBookings = bookings.filter(b => b.date === todayStr);

  return (
    <div className="space-y-4 sm:space-y-6">

      {/* 7-Day Completed Bookings Visualization (Replacing RidgeLine AI Dispatcher card) */}
      <CompletedBookingsChart 
        bookings={bookings} 
        settings={settings} 
        isLoading={isDataLoading}
      />

      {/* 4 Metric Cards */}
      <MetricCards 
        bookings={bookings} 
        missedCalls={missedCalls} 
        threads={threads} 
        isLoading={isDataLoading}
      />

      {/* Main Split Grid: Today's Route */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6">

        {/* Today's Dispatch Timeline & Priority Jobs */}
        <div className="space-y-4">
          <div className="rounded-lg border border-neutral-200 bg-white p-3.5 sm:p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-neutral-900 flex items-center gap-2 font-head">
                  <Calendar className="h-4 w-4 text-neutral-700 shrink-0" />
                  <span>Today's Dispatches ({todayBookings.length} jobs)</span>
                </h3>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Route optimization for {settings.tradespersonName}
                </p>
              </div>

              <button
                onClick={() => router.push('/dispatch')}
                className="text-xs font-medium text-neutral-600 hover:text-neutral-900 flex items-center gap-1 self-start sm:self-auto cursor-pointer"
              >
                <span>Full Schedule</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="divide-y divide-neutral-100 mt-2">
              {todayBookings.length === 0 ? (
                <div className="py-8 text-center text-xs text-neutral-500">
                  No jobs scheduled for today. AI is monitoring for incoming bookings!
                </div>
              ) : (
                todayBookings.map((job) => (
                  <div key={job.id} className="py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-1 w-full sm:w-auto min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-neutral-900 font-mono">
                          {job.timeSlot}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          job.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : job.status === 'in_progress'
                            ? 'bg-blue-100 text-blue-800'
                            : job.status === 'en_route'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-neutral-100 text-neutral-800'
                        }`}>
                          {job.status === 'in_progress' ? 'ON SITE' : job.status.toUpperCase()}
                        </span>
                        {job.urgency === 'emergency' && (
                          <span className="text-[10px] text-red-600 font-bold flex items-center gap-0.5">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Emergency
                          </span>
                        )}
                      </div>

                      <h4 className="text-xs font-semibold text-neutral-900">
                        {job.serviceTitle}
                      </h4>

                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                        <span>{job.customerName}</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 min-w-0">
                          <MapPin className="h-3 w-3 text-neutral-400 shrink-0" />
                          <span className="truncate max-w-[200px] sm:max-w-xs">{job.address}</span>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto pt-2 sm:pt-0 border-t sm:border-t-0 border-neutral-100">
                      <span className="text-xs font-bold font-mono count-up tabular-nums text-neutral-900 mr-2">
                        {formatCurrency(job.estimateAmount)}
                      </span>

                      {job.status === 'scheduled' && (
                        <button
                          onClick={() => handleSendEtaSms(job)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-800 cursor-pointer"
                          title="Send 15m ETA text to customer"
                        >
                          <Truck className="h-3 w-3 text-amber-600" />
                          <span>En Route</span>
                        </button>
                      )}

                      {job.status === 'en_route' && (
                        <button
                          onClick={() => handleUpdateStatus(job.id, 'in_progress')}
                          className="px-2.5 py-1 text-xs font-medium rounded bg-blue-50 text-blue-800 border border-blue-200 cursor-pointer"
                        >
                          Arrived
                        </button>
                      )}

                      {job.status === 'in_progress' && (
                        <button
                          onClick={() => handleUpdateStatus(job.id, 'completed')}
                          className="px-2.5 py-1 text-xs font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                        >
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="pt-3 border-t border-neutral-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-neutral-500">
              <span>Next opening today: <span className="font-mono font-medium text-neutral-700">03:45 PM - 05:00 PM</span></span>
              <button
                onClick={() => setIsNewBookingOpen(true)}
                className="text-neutral-900 font-semibold hover:underline flex items-center gap-1 self-end sm:self-auto cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Manual Job
              </button>
            </div>
          </div>

          {/* Missed Call Quick Triage Bar */}
          <div className="rounded-lg border border-neutral-200 bg-white p-3.5 sm:p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-100 pb-2.5">
              <h3 className="text-xs font-bold text-neutral-900 flex items-center gap-2 font-head">
                <PhoneMissed className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>Recent Missed Calls ({unconvertedCallsCount} pending reply)</span>
              </h3>
              <button
                onClick={() => router.push('/missed-calls')}
                className="text-xs text-neutral-600 hover:text-neutral-900 flex items-center gap-1 self-start sm:self-auto cursor-pointer"
              >
                <span>All Calls</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <div className="divide-y divide-neutral-100 mt-2 text-xs">
              {missedCalls.slice(0, 3).map((call) => (
                <div key={call.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0 w-full sm:w-auto">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-neutral-900">{call.callerName}</span>
                      <span className="font-mono text-[11px] text-neutral-500">{call.callerPhone}</span>
                    </div>
                    <p className="text-[11px] text-neutral-500 line-clamp-1 italic mt-0.5">
                      "{call.voicemailTranscript}"
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-neutral-100">
                    {call.convertedToBooking ? (
                      <span className="text-[10px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded font-medium">
                        Converted
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded font-medium">
                        Auto-SMS Sent
                      </span>
                    )}

                    <button
                      onClick={() => openThreadForPhone(call.callerPhone)}
                      className="p-1.5 text-neutral-500 hover:text-neutral-900 rounded hover:bg-neutral-100 transition-colors cursor-pointer"
                      title="Open SMS Thread"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
