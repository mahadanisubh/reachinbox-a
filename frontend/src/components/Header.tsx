import { memo } from 'react';
import type { User } from '../types';
import { Button } from './Button';

export const Header = memo(function Header({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const source = user.name?.trim() || user.email;
  const initial = source.slice(0, 1).toUpperCase();
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
          R
        </div>
        <span className="text-base font-semibold text-slate-900">ReachInbox</span>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 select-none items-center justify-center rounded-full bg-brand/10 text-sm font-semibold text-brand ring-1 ring-brand/20"
          aria-hidden="true"
          title={source}
        >
          {initial}
        </div>
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium leading-tight text-slate-900">{user.name ?? 'User'}</p>
          <p className="text-xs leading-tight text-slate-500">{user.email}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onLogout}>
          Logout
        </Button>
      </div>
    </header>
  );
});
