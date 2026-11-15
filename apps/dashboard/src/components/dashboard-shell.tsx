'use client';

import React, { useEffect, useState } from 'react';
import { Navbar } from './navbar';
import { Sidebar } from './sidebar';
import { api } from '../lib/api';

interface DashboardShellProps {
  children: React.ReactNode;
  onRefresh?: () => Promise<void> | void;
}

export function DashboardShell({ children, onRefresh }: DashboardShellProps) {
  const [openRefundsCount, setOpenRefundsCount] = useState<number>(0);
  const [activeAlertsCount, setActiveAlertsCount] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const fetchBadgeCounts = async () => {
    try {
      const [refundsRes, alertsRes] = await Promise.allSettled([
        api.getRefundsReport('open'),
        api.listAlerts('active'),
      ]);

      if (refundsRes.status === 'fulfilled') {
        setOpenRefundsCount(refundsRes.value.data.summary.statusCounts.open);
      }
      if (alertsRes.status === 'fulfilled') {
        setActiveAlertsCount(alertsRes.value.data.length);
      }
    } catch {
      // Ignore background badge fetch errors
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await fetchBadgeCounts();
      if (onRefresh) {
        await onRefresh();
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchBadgeCounts();

    // 10-second polling interval per Plan Phase 7 Task 4
    const interval = setInterval(() => {
      fetchBadgeCounts();
      if (onRefresh) {
        onRefresh();
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [onRefresh]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        openRefundsCount={openRefundsCount}
        activeAlertsCount={activeAlertsCount}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar onRefresh={handleManualRefresh} isRefreshing={isRefreshing} />
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
