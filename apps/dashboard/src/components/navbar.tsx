'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, User } from '../lib/api';
import { LogOut, RefreshCw, Shield, User as UserIcon } from 'lucide-react';

interface NavbarProps {
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function Navbar({ onRefresh, isRefreshing }: NavbarProps) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    api
      .getMe()
      .then((res) => setUser(res.data))
      .catch(() => {
        // Not authenticated
        router.push('/login');
      });
  }, [router]);

  const handleLogout = async () => {
    try {
      await api.logout();
      router.push('/login');
    } catch {
      router.push('/login');
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-30 shadow-sm">
      <div className="flex items-center space-x-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm tracking-wider shadow-sm">
          WRM
        </div>
        <div>
          <span className="font-semibold text-slate-800 text-base">Water Refill Machine</span>
          <span className="ml-2 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
            Operator Ops
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center space-x-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 rounded-md border border-slate-200 transition-colors disabled:opacity-50"
            title="Refresh dashboard (polls automatically every 10s)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        )}

        {user && (
          <div className="flex items-center space-x-3 pl-4 border-l border-slate-200">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-slate-600">
                <UserIcon className="w-4 h-4" />
              </div>
              <div className="text-left text-xs">
                <p className="font-medium text-slate-700 leading-none">{user.name}</p>
                <div className="flex items-center space-x-1 mt-0.5">
                  <Shield className="w-3 h-3 text-blue-500" />
                  <span className="capitalize text-slate-500 font-semibold">{user.role}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
