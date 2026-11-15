'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  BarChart3,
  Cpu,
  CreditCard,
  LayoutDashboard,
  Undo2,
  Users,
} from 'lucide-react';

interface SidebarProps {
  openRefundsCount?: number;
  activeAlertsCount?: number;
}

export function Sidebar({ openRefundsCount = 0, activeAlertsCount = 0 }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/machines', label: 'Machines', icon: Cpu },
    {
      href: '/refunds',
      label: 'Refund Queue',
      icon: Undo2,
      badge: openRefundsCount > 0 ? openRefundsCount : undefined,
      badgeColor: 'bg-amber-100 text-amber-800 border-amber-300',
    },
    { href: '/payments', label: 'Payments', icon: CreditCard },
    {
      href: '/alerts',
      label: 'Alerts',
      icon: AlertTriangle,
      badge: activeAlertsCount > 0 ? activeAlertsCount : undefined,
      badgeColor: 'bg-red-100 text-red-800 border-red-300',
    },
    { href: '/reports', label: 'Sales Reports', icon: BarChart3 },
    { href: '/users', label: 'Users & Audit', icon: Users },
  ];

  return (
    <aside className="w-64 bg-slate-900 text-slate-300 min-h-screen flex flex-col border-r border-slate-800 shrink-0">
      <div className="p-4 border-b border-slate-800">
        <div className="text-xs font-semibold tracking-wider text-slate-400 uppercase">
          Operations
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-bold border ${item.badgeColor}`}
                >
                  {item.badge}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 text-xs text-slate-500 text-center">
        WRM Backend v0.1.0 • Phase 7
      </div>
    </aside>
  );
}
