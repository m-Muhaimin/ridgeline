import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  initialBookings,
  initialThreads,
  initialMissedCalls,
  initialServices,
  initialSettings,
  initialOrganizations,
  initialCustomers,
} from '../mockData';
import {
  JobBooking,
  SmsThread,
  SmsMessage,
  MissedCall,
  TradeService,
  AssistantSettings,
  BookingStatus,
  Organization,
  User,
  Customer,
  SettingsSubTab,
} from '../types';
import { apiFetch } from '../lib/apiFetch';
import { detectEmergency } from '../lib/triage';

/**
 * Cross-view data context. Every view page reads its data and mutates it
 * through `useData()`; the dashboard routes under `app/` all render inside
 * this provider, so there is no per-view fetching.
 *
 * Each collection is seeded from `../mockData` on mount and then overwritten
 * from `/api/neon/data`, which means there are two sources of truth for every
 * list until that fetch resolves.
 */

export type TradespersonStatus = 'on_call' | 'available' | 'driving';

export interface SmsProcessResult {
  replyText: string;
  actionTag?: any;
  shouldConfirmBooking?: boolean;
  extractedDetails?: any;
}

export interface DataContextValue {
  currentUser: User | null;            // App.tsx:91
  isAuthLoading: boolean;              // App.tsx:92
  isDataLoading: boolean;              // App.tsx:88
  organizations: Organization[];       // 76  seeded initialOrganizations
  currentOrg: Organization;            // 77  seeded initialOrganizations[0]
  bookings: JobBooking[];              // 78
  threads: SmsThread[];                // 79
  missedCalls: MissedCall[];           // 80
  customers: Customer[];               // 81
  services: TradeService[];            // 82
  settings: AssistantSettings;         // 83
  selectedThreadId: string;            // 84
  tradespersonStatus: TradespersonStatus;            // 85
  setTradespersonStatus: (s: TradespersonStatus) => void;
  neonConnected: boolean;              // 86
  neonLatency: number;                 // 87
  unreadSmsCount: number;              // 247
  unconvertedCallsCount: number;       // 248
  isNewBookingOpen: boolean; setIsNewBookingOpen: (open: boolean) => void;   // 235
  toastMessage: string | null; showToast: (msg: string) => void;             // 238/240
  settingsSubTab: SettingsSubTab; setSettingsSubTab: (t: SettingsSubTab) => void;
  syncFromNeon: (showLoading?: boolean) => Promise<void>;
  handleLogout: () => Promise<void>;
  handleSelectOrg: (org: Organization) => Promise<void>;
  handleAddOrg: (newOrg: Omit<Organization, 'id'>) => void;
  handleUpdateOrg: (updated: Organization) => void;
  handleUpdateSettings: (s: AssistantSettings) => void;
  handleAddService: (s: Omit<TradeService, 'id'>) => Promise<void>;
  handleDeleteService: (id: string) => void;
  handleAddBooking: (newJob: Omit<JobBooking, 'id' | 'createdAt'>) => Promise<void>;
  handleUpdateStatus: (id: string, newStatus: BookingStatus) => void;
  handleSendEtaSms: (booking: JobBooking) => void;
  selectThread: (threadId: string) => void;          // setSelectedThreadId only
  openThread: (threadId: string) => void;            // selectThread + router.push('/sms')
  openThreadForPhone: (phone: string) => void;       // find in threads, then openThread
  handleSendMessage: (threadId: string, text: string, sender: 'customer' | 'assistant' | 'tradesperson', actionTag?: SmsMessage['actionTag'], senderName?: string) => void;
  handleProcessCustomerSms: (threadId: string, incomingText: string) => Promise<SmsProcessResult>;
  handleAutoConfirmFromSms: (thread: SmsThread, details: any) => Promise<void>;
  handleToggleTakeover: (threadId: string, forceStatus?: boolean) => void;
  handleSendTestSms: (text: string, customerName?: string, customerPhone?: string) => Promise<string>;
}

const DataContext = createContext<DataContextValue | null>(null);

export const DataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();

  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>('general');   // 75
  const [organizations, setOrganizations] = useState<Organization[]>(initialOrganizations);
  const [currentOrg, setCurrentOrg] = useState<Organization>(initialOrganizations[0]);
  const [bookings, setBookings] = useState<JobBooking[]>(initialBookings);
  const [threads, setThreads] = useState<SmsThread[]>(initialThreads);
  const [missedCalls, setMissedCalls] = useState<MissedCall[]>(initialMissedCalls);
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [services, setServices] = useState<TradeService[]>(initialServices);
  const [settings, setSettings] = useState<AssistantSettings>(initialSettings);
  const [selectedThreadId, setSelectedThreadId] = useState<string>(initialThreads[0].id);
  const [tradespersonStatus, setTradespersonStatus] = useState<TradespersonStatus>('available');
  const [neonConnected, setNeonConnected] = useState<boolean>(true);
  const [neonLatency, setNeonLatency] = useState<number>(780);
  const [isDataLoading, setIsDataLoading] = useState<boolean>(true);

  // User Auth & Onboarding State
  const [currentUser, setCurrentUser] = useState<User | null>(null);       // 91
  const [isAuthLoading, setIsAuthLoading] = useState(true);               // 92

  // Modals                                                                    // 235
  const [isNewBookingOpen, setIsNewBookingOpen] = useState(false);

  // Live Toast Notification                                                  // 238
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {                                     // 240-245
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Sync state from live Neon Lakebase Postgres                              // 95-145
  const syncFromNeon = async (showLoading = true) => {
    if (showLoading) setIsDataLoading(true);
    const start = Date.now();
    try {
      const [data, status] = await Promise.all([
        apiFetch('/api/neon/data').catch(() => null),
        apiFetch('/api/neon/status').catch(() => null),
      ]);

      if (status) {
        setNeonConnected(status.connected);
        if (status.latencyMs) setNeonLatency(status.latencyMs);
      }

      if (data) {
        if (data.organizations?.length > 0) {
          setOrganizations(data.organizations);
          setCurrentOrg(data.organizations[0]);
        }
        if (data.bookings?.length > 0) {
          setBookings(data.bookings);
        }
        if (data.threads?.length > 0) {
          setThreads(data.threads);
          setSelectedThreadId(data.threads[0].id);
        }
        if (data.services?.length > 0) {
          setServices(data.services);
        }
        if (data.missedCalls?.length > 0) {
          setMissedCalls(data.missedCalls);
        }
        if (data.customers?.length > 0) {
          setCustomers(data.customers);
        }
        if (data.assistantSettings) {
          setSettings(data.assistantSettings);
        }
      }
    } catch (err) {
      console.warn('Neon initial sync skipped, using memory cache:', err);
    } finally {
      if (showLoading) {
        const elapsed = Date.now() - start;
        const delay = Math.max(0, 500 - elapsed);
        setTimeout(() => {
          setIsDataLoading(false);
        }, delay);
      }
    }
  };

  useEffect(() => {                                                         // 147-167
    async function checkAuth() {
      setIsAuthLoading(true);
      try {
        const data = await apiFetch('/api/auth/me');
        if (data.user) {
          setCurrentUser(data.user);
        } else {
          setCurrentUser(null);
        }
      } catch (e) {
        console.warn('Auth check skipped:', e);
        setCurrentUser(null);
      } finally {
        setIsAuthLoading(false);
      }
    }

    syncFromNeon(true);
    checkAuth();
  }, []);

  const handleLogout = async () => {                                        // 179-188
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout error:', e);
    }
    setCurrentUser(null);
    showToast('Signed out of RidgeLine.');
    router.push('/auth');
  };

  // Handle Organization switching                                            // 203-224
  const handleSelectOrg = async (org: Organization) => {
    setCurrentOrg(org);
    setSettings((prev) => ({
      ...prev,
      businessName: org.name,
      tradeType: org.trade,
      tradespersonName: org.technicianName,
      twilioPhoneNumber: org.twilioPhoneNumber,
    }));
    try {
      await apiFetch('/api/organizations/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: org.id }),
      });
    } catch (e) {
      console.warn('Organization switch error:', e);
    }
    showToast(`Switched workspace to ${org.name}`);
    syncFromNeon(true);
  };

  const handleAddOrg = (newOrg: Omit<Organization, 'id'>) => {              // 226-232
    const id = `org-${Date.now().toString().slice(-4)}`;
    const created: Organization = { ...newOrg, id };
    setOrganizations((prev) => [...prev, created]);
    handleSelectOrg(created);
    showToast(`Organization "${newOrg.name}" created!`);
  };

  const unreadSmsCount = threads.reduce((acc, t) => acc + (t.unreadCount || 0), 0);   // 247
  const unconvertedCallsCount = missedCalls.filter((m) => !m.convertedToBooking).length; // 248

  // Process customer SMS via backend Gemini endpoint                         // 251-327
  const handleProcessCustomerSms = async (
    threadId: string,
    incomingText: string
  ): Promise<SmsProcessResult> => {
    const thread = threads.find((t) => t.id === threadId);

    try {
      const data = await apiFetch('/api/sms/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incomingText,
          customerName: thread?.customerName || 'Customer',
          customerPhone: thread?.customerPhone || '+1 (555) 000-0000',
          address: thread?.address || '',
          conversationHistory: thread?.messages || [],
          existingBookings: bookings,
          services,
          settings,
        }),
      });

      return {
        replyText: data.replyText,
        actionTag: data.actionTag,
        shouldConfirmBooking: data.shouldConfirmBooking,
        extractedDetails: {
          serviceTitle: data.serviceTitle,
          requestedSlot: data.requestedSlot ?? null,
          address: data.extractedAddress || thread?.address,
          price: data.estimatedPrice,
          urgency: data.urgency,
          intent: data.intent,
        },
      };
    } catch (err) {
      console.warn('Backend call failed, using intelligent rule-based trade engine fallback:', err);
      const lower = incomingText.toLowerCase();
      const techName = settings.tradespersonName || currentUser?.fullName || 'Technician';
      let replyText = `Thanks for reaching out! ${techName} is on a service call. Can you share your street address and what issue you're having?`;
      let actionTag: any = 'info_requested';
      let shouldConfirm = false;

      // With no backend there is no availability source, so this fallback may
      // not name a time. It asks, and the real openings come from the server.
      // The emergency rules are the same ones the server uses, so an offline
      // preview never contradicts the live reply.
      const triage = detectEmergency(incomingText, settings.emergencyKeywords);
      if (triage.isEmergency) {
        replyText = `${triage.guidance} ${techName} will get on this as fast as possible - what is your street address?`;
        actionTag = 'emergency_escalated';
      } else if (lower.includes('reschedule') || lower.includes('push') || lower.includes('can we do')) {
        replyText = `No problem! I can move that - tell me which time works and I'll update ${techName}'s calendar.`;
        actionTag = 'slot_offered';
      } else if (lower.includes('yes') || lower.includes('confirm') || lower.includes('works') || lower.includes('book')) {
        replyText = `Great - tell me which time works and I'll lock it in on ${techName}'s schedule. ${techName} will text when 15 minutes away with the truck.`;
        actionTag = 'slot_offered';
      } else if (lower.includes('how much') || lower.includes('cost') || lower.includes('quote')) {
        replyText = `Our diagnostic & basic service call is $195-$285 depending on parts required. Want me to check ${techName}'s openings?`;
        actionTag = 'quote_given';
      }

      return {
        replyText,
        actionTag,
        shouldConfirmBooking: shouldConfirm,
        extractedDetails: {
          serviceTitle: 'Main Line Drain Snaking / Hydrojet',
          requestedSlot: null,
          address: thread?.address || '742 Evergreen Terrace',
          price: 285,
          urgency: 'routine',
          intent: 'book',
        },
      };
    }
  };

  // Add message to thread                                                     // 330-393
  const handleSendMessage = (
    threadId: string,
    text: string,
    sender: 'customer' | 'assistant' | 'tradesperson',
    actionTag?: SmsMessage['actionTag'],
    senderName?: string
  ) => {
    const currentUserName = currentUser?.fullName || settings.tradespersonName || 'Technician';
    const resolvedSenderName =
      senderName ||
      (sender === 'assistant'
        ? 'RidgeLine AI Dispatcher'
        : sender === 'tradesperson'
        ? currentUserName
        : threads.find((t) => t.id === threadId)?.customerName || 'Customer');

    const newMsg: SmsMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      threadId,
      sender,
      senderName: resolvedSenderName,
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'delivered' as const,
      actionTag,
      parsedIntent: { senderName: resolvedSenderName },
    };

    const thread = threads.find((t) => t.id === threadId);

    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === threadId) {
          return {
            ...t,
            lastActivity: newMsg.timestamp,
            messages: [...t.messages, newMsg],
            unreadCount: sender === 'customer' ? (t.unreadCount || 0) + 1 : 0,
          };
        }
        return t;
      })
    );

    // Persist message to Neon Postgres
    try {
      apiFetch('/api/sms/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          sender,
          senderName: resolvedSenderName,
          text,
          actionTag,
          customerName: thread?.customerName,
          customerPhone: thread?.customerPhone,
          address: thread?.address,
          tradeType: thread?.tradeType || settings.tradeType,
        }),
      }).catch((err) => console.warn('Neon message persist err:', err));
    } catch (e) {
      // ignore
    }
  };

  // Toggle human takeover for a thread                                        // 396-409
  const handleToggleTakeover = (threadId: string, forceStatus?: boolean) => {
    const currentUserName = currentUser?.fullName || settings.tradespersonName || 'Technician';
    setThreads((prev) =>
      prev.map((t) => {
        if (t.id === threadId) {
          const newTaken = forceStatus !== undefined ? forceStatus : !t.isTakenOver;
          return {
            ...t,
            isTakenOver: newTaken,
            takenOverBy: newTaken ? currentUserName : undefined,
          };
        }
        return t;
      })
    );
  };

  // Auto-confirm or reschedule booking from SMS.
  //
  // This never invents a time. A slot is written only when the customer named
  // one, or when they confirm a real opening from /api/availability. The date
  // is derived in the organization's zone, not UTC. If the server rejects the
  // booking we surface that instead of quietly creating a local row, which
  // used to hide double-bookings from the operator.
  const handleAutoConfirmFromSms = async (thread: SmsThread, details: any): Promise<void> => {  // 418-503
    const isReschedule = details?.intent === 'reschedule';
    const orgZone = currentOrg?.timezone || 'UTC';

    const zoneDate = (offsetDays: number) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: orgZone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date(Date.now() + offsetDays * 86400000));

    let slot: string | null = details?.requestedSlot || null;

    if (!slot) {
      // Nothing was stated: ask the server what is genuinely open.
      let offers: Array<{ date: string; label: string }> = [];
      try {
        const data = await apiFetch(`/api/availability?service=${encodeURIComponent(details?.serviceTitle || '')}&limit=3`);
        offers = data.offers || [];
      } catch (err) {
        console.warn('Availability lookup failed', err);
      }
      if (offers.length === 0) {
        showToast('No verified opening available - ask the technician to call the customer.');
        return;
      }
      const chosen = offers[0];
      slot = chosen.label;
      showToast(`Next real opening for ${thread.customerName}: ${chosen.date} ${chosen.label}`);
      return; // proposing is not booking: the customer must confirm first
    }

    if (isReschedule && thread.bookingId) {
      const nextDay = zoneDate(1);
      const data = await apiFetch(`/api/bookings/${thread.bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: nextDay, timeSlot: slot }),
      });
      if (data.booking) {
        setBookings((prev) => prev.map((b) => (b.id === thread.bookingId ? data.booking : b)));
      } else {
        setBookings((prev) =>
          prev.map((b) =>
            b.id === thread.bookingId
              ? { ...b, date: nextDay, timeSlot: slot, notes: `${b.notes} (Rescheduled via SMS)` }
              : b,
          )
        );
      }
      setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, status: 'rescheduled' } : t)));
      showToast(`Appointment for ${thread.customerName} was rescheduled via SMS.`);
      return;
    }

    const newBookingData = {
      customerName: thread.customerName,
      customerPhone: thread.customerPhone,
      address: details?.address || thread.address || '312 Elm Street, Springfield',
      tradeType: thread.tradeType || 'plumbing',
      serviceTitle: details?.serviceTitle || 'General Service Diagnostic & Repair',
      date: zoneDate(0),
      timeSlot: slot,
      status: 'scheduled' as const,
      estimateAmount: details?.price || 285,
      notes: `Auto-booked by RidgeLine AI Assistant via SMS thread.`,
      urgency: details?.urgency || 'routine',
      createdFrom: 'sms' as const,
      smsThreadId: thread.id,
    };

    try {
      const data = await apiFetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBookingData),
      });
      if (data.booking) {
        setBookings((prev) => [data.booking, ...prev]);
        setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, bookingId: data.booking.id, status: 'booked' } : t)));
        showToast(`Job booked for ${thread.customerName} at ${slot} & saved to Neon Postgres!`);
        return;
      }
      throw new Error('Booking was not created');
    } catch (err: any) {
      // 409 SLOT_UNAVAILABLE and 400 UNPARSEABLE_SLOT land here. The schedule
      // on screen stays truthful: nothing is added locally.
      console.warn('Booking rejected by server', err);
      setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, status: 'active' } : t)));
      showToast(err?.message || 'That slot could not be booked.');
    }
  };

  // Send 15-minute ETA SMS to customer                                        // 506-522
  const handleSendEtaSms = (booking: JobBooking) => {
    const etaText = `Hey ${booking.customerName.split(' ')[0]}! Mark is currently en route in the service van. Estimated arrival is ~15 minutes. See you soon!`;

    const thread = threads.find((t) => t.id === booking.smsThreadId || t.customerPhone === booking.customerPhone);
    if (thread) {
      handleSendMessage(thread.id, etaText, 'tradesperson');
    }

    setBookings((prev) => prev.map((b) => (b.id === booking.id ? { ...b, status: 'en_route' } : b)));
    apiFetch(`/api/bookings/${booking.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'en_route' }),
    }).catch((e) => console.warn(e));
    showToast(`15-min ETA text sent to ${booking.customerName} (${booking.customerPhone})`);
  };

  // Update status directly                                                    // 525-534
  const handleUpdateStatus = (id: string, newStatus: BookingStatus) => {
    setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: newStatus } : b)));
    apiFetch(`/api/bookings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    }).catch((e) => console.warn(e));
    showToast(`Job status updated to ${newStatus.replace('_', ' ').toUpperCase()}`);
  };

  // Test SMS Simulator handler                                                // 537-565
  const handleSendTestSms = async (
    text: string,
    customerName = 'Homeowner',
    customerPhone = '+1 (555) 777-1234'
  ): Promise<string> => {
    let thread = threads.find((t) => t.customerPhone === customerPhone);
    if (!thread) {
      const threadId = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `th-sim-${Date.now().toString().slice(-4)}`;
      thread = {
        id: threadId,
        customerName,
        customerPhone,
        tradeType: settings.tradeType,
        unreadCount: 0,
        lastActivity: 'Just now',
        status: 'active',
        messages: [],
      };
      setThreads((prev) => [thread!, ...prev]);
    }

    const result = await handleProcessCustomerSms(thread.id, text);
    handleSendMessage(thread.id, text, 'customer');
    handleSendMessage(thread.id, result.replyText, 'assistant', result.actionTag);

    if (result.shouldConfirmBooking) {
      handleAutoConfirmFromSms(thread, result.extractedDetails);
    }

    return result.replyText;
  };

  // OrganizationSettings inline handlers, renamed to the handle* contract    // 922-1022
  const handleUpdateOrg = (updated: Organization) => {
    const previous = currentOrg;
    // Optimistic, but reverted on failure: the server validates
    // values (e.g. rejects an unknown time zone), and a bare
    // fetch().catch(console.warn) would leave a rejected save
    // looking saved.
    setCurrentOrg(updated);
    setOrganizations((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    apiFetch('/api/organizations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(updated),
    })
      .then((res: any) => {
        // Re-sync from the server's authoritative row (RETURNING *).
        if (res?.organization) {
          setCurrentOrg(res.organization);
          setOrganizations((prev) => prev.map((o) => (o.id === res.organization.id ? res.organization : o)));
        }
      })
      .catch((e) => {
        setCurrentOrg(previous);
        setOrganizations((prev) => prev.map((o) => (o.id === previous.id ? previous : o)));
        showToast(`Could not save organization: ${e.message}`);
      });
  };

  const handleUpdateSettings = (newSettings: AssistantSettings) => {
    setSettings(newSettings);
    apiFetch('/api/assistant-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings),
    }).catch((e) => console.warn('Settings update err:', e));
  };

  const handleAddService = async (newSrv: Omit<TradeService, 'id'>) => {
    const id = `srv-${Date.now()}`;
    setServices((prev) => [...prev, { ...newSrv, id }]);
    try {
      const data = await apiFetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newSrv),
      });
      if (data.service) {
        setServices((prev) => prev.map((s) => (s.id === id ? data.service : s)));
      }
    } catch (e) {
      console.warn('Service add err:', e);
    }
  };

  const handleDeleteService = (id: string) => {
    setServices((prev) => prev.filter((s) => s.id !== id));
    apiFetch(`/api/services/${id}`, {
      method: 'DELETE',
    }).catch((e) => console.warn('Service delete err:', e));
    showToast('Service removed from catalog.');
  };

  const handleAddBooking = async (newJob: Omit<JobBooking, 'id' | 'createdAt'>) => {
    try {
      const data = await apiFetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(newJob),
      });
      if (data.booking) {
        setBookings((prev) => [data.booking, ...prev]);
        showToast(`Job for ${newJob.customerName} saved to Neon Lakebase Postgres!`);
        return;
      }
    } catch (err) {
      console.warn('Booking insert fallback', err);
    }

    const id = `bk-${Date.now().toString().slice(-4)}`;
    setBookings((prev) => [{ ...newJob, id, createdAt: new Date().toISOString() }, ...prev]);
    showToast(`Job for ${newJob.customerName} added to dispatch schedule.`);
  };

  // Navigation helpers. App.tsx paired setSelectedThreadId with setActiveTab at
  // 833-839 and 898-904; the URL is the tab now.
  const selectThread = (threadId: string) => setSelectedThreadId(threadId);

  const openThread = (threadId: string) => {
    setSelectedThreadId(threadId);
    router.push('/sms');
  };

  const openThreadForPhone = (phone: string) => {
    const match = threads.find((t) => t.customerPhone === phone);
    if (match) {
      openThread(match.id);
    }
  };

  const value: DataContextValue = {
    currentUser,
    isAuthLoading,
    isDataLoading,
    organizations,
    currentOrg,
    bookings,
    threads,
    missedCalls,
    customers,
    services,
    settings,
    selectedThreadId,
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
    handleUpdateOrg,
    handleUpdateSettings,
    handleAddService,
    handleDeleteService,
    handleAddBooking,
    handleUpdateStatus,
    handleSendEtaSms,
    selectThread,
    openThread,
    openThreadForPhone,
    handleSendMessage,
    handleProcessCustomerSms,
    handleAutoConfirmFromSms,
    handleToggleTakeover,
    handleSendTestSms,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export function useData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error('useData must be used within a DataProvider.');
  }
  return context;
}
