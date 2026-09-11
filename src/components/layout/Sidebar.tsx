import React, { useState } from 'react';
import mclLogo from '../../assets/logo.png';
import { Home, Layers, Package, Shirt, Settings, User } from 'lucide-react';
import type { Account } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';
import { MINECRAFT_AVATAR_ICONS } from '../profile/ProfileView';
import { ProfileCard } from '../profile/ProfileCard';

export type NavigationTab = 'home' | 'instances' | 'mods' | 'skin' | 'settings' | 'profile';

interface SidebarProps {
  currentTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  account: Account;
  onUpdateUsername: (newName: string) => void;
  onUpdateAccount?: (updated: Account) => void;
  language: Language;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  account,
  onUpdateUsername,
  onUpdateAccount,
  language,
}) => {
  const t = getTranslation(language);
  const [isProfileCardOpen, setIsProfileCardOpen] = useState(false);

  const navItems = [
    { id: 'home', label: t.navHome, icon: Home },
    { id: 'instances', label: t.navInstances, icon: Layers },
    { id: 'mods', label: t.navMods, icon: Package },
    { id: 'skin', label: t.navSkin, icon: Shirt },
    { id: 'settings', label: t.navSettings, icon: Settings },
  ];

  // Resolve preset icon if active
  const presetAvatar =
    MINECRAFT_AVATAR_ICONS.find((i) => i.id === (account.avatarIcon || 'creeper')) ||
    MINECRAFT_AVATAR_ICONS[0];

  const activeNavIndex = navItems.findIndex((item) => item.id === currentTab);
  const navContainerRef = React.useRef<HTMLDivElement>(null);
  const buttonRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicatorTop, setIndicatorTop] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = buttonRefs.current[currentTab];
    const container = navContainerRef.current;
    if (el && container) {
      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setIndicatorTop(elRect.top - containerRect.top);
    } else {
      setIndicatorTop(null);
    }
  }, [currentTab]);

  return (
    <aside className="w-20 bg-[#111111]/[0.86] flex flex-col justify-between items-center py-5 select-none z-50 shrink-0 h-full border-none shadow-none">
      {/* Top MCL Logo - Subdued, Unclickable */}
      <div className="w-full flex items-center justify-center pt-1 select-none pointer-events-none">
        <img
          src={mclLogo}
          alt="MCL"
          className="w-10 h-auto object-contain opacity-85 hover:opacity-100 transition-opacity drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
        />
      </div>

      {/* Vertically Centered Navigation Menu Cluster with Smooth Sliding Active Indicator & Tile */}
      <div className="flex-1 flex flex-col items-center justify-center w-full">
        <div ref={navContainerRef} className="relative flex flex-col items-center gap-7 w-full">
          {/* Smooth Sliding Active Indicator Bar along Left Edge */}
          <div
            className="absolute left-0 w-1.5 rounded-r bg-[var(--accent-color)] shadow-accent-glow transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-none"
            style={{
              top: `${(indicatorTop ?? 0) + 6}px`,
              height: '36px',
              opacity: indicatorTop !== null ? 1 : 0,
            }}
          />

          {/* Smooth Sliding Active Backdrop Tile behind active nav button */}
          <div
            className="absolute left-0 right-0 mx-auto w-12 h-12 rounded-xl bg-white/10 shadow-sm transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-none"
            style={{
              top: `${indicatorTop ?? 0}px`,
              opacity: indicatorTop !== null ? 1 : 0,
            }}
          />

          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <div key={item.id} className="relative group flex items-center justify-center w-full h-12 shrink-0">
                <button
                  ref={(el) => {
                    buttonRefs.current[item.id] = el;
                  }}
                  onClick={() => {
                    setIsProfileCardOpen(false);
                    onTabChange(item.id as NavigationTab);
                  }}
                  className={`relative z-10 w-12 h-12 rounded-xl flex items-center justify-center transition-colors duration-150 border-none outline-none cursor-pointer ${
                    isActive
                      ? 'text-[var(--accent-color)]'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
                  }`}
                >
                  <Icon className="w-6 h-6" />
                </button>

                {/* Pure CSS Tooltip (Zero JS delay, positioned comfortably outside sidebar) */}
                <div className="absolute left-[88px] px-3.5 py-1.5 rounded-lg bg-[#161616] border border-white/10 text-xs font-semibold text-white shadow-2xl whitespace-nowrap z-[60] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                  {item.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Account Avatar at Bottom -> Opens Discord-Style Compact Profile Card */}
      <div className="relative group flex flex-col items-center px-2 pb-1 w-full">
        {/* Left Edge Active Indicator Bar for Profile */}
        <span
          className={`absolute left-0 top-2 bottom-2 w-1.5 rounded-r bg-[var(--accent-color)] shadow-accent-glow transition-opacity duration-200 pointer-events-none ${
            isProfileCardOpen ? 'opacity-100' : 'opacity-0'
          }`}
        />

        <button
          onClick={() => setIsProfileCardOpen((prev) => !prev)}
          title={account.username}
          aria-label="User Profile"
          className={`relative w-12 h-12 rounded-full overflow-hidden bg-[#171717]/80 border transition-all duration-150 flex items-center justify-center outline-none cursor-pointer ${
            isProfileCardOpen
              ? 'border-[var(--accent-color)] ring-2 ring-[var(--accent-color)]/40 shadow-[0_0_12px_var(--accent-glow)] scale-105'
              : 'border-white/10 hover:border-[var(--accent-color)]/60 hover:scale-105'
          }`}
        >
          {account.avatarCustom ? (
            <img
              src={account.avatarCustom}
              alt={account.username}
              className="w-full h-full object-cover"
            />
          ) : account.avatarIcon ? (
            <div className={`w-full h-full flex items-center justify-center text-lg bg-gradient-to-br ${presetAvatar.color}`}>
              <span className="select-none">{presetAvatar.icon}</span>
            </div>
          ) : (
            <User className="w-6 h-6 text-[var(--accent-color)]" />
          )}
        </button>

        {/* Pure CSS Tooltip for profile (hidden when card is open) */}
        {!isProfileCardOpen && (
          <div className="absolute left-[88px] bottom-2 px-3.5 py-2 rounded-lg bg-[#161616] border border-white/10 text-xs text-white shadow-2xl whitespace-nowrap z-[60] pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-100">
            <div className="font-bold text-[var(--accent-color)] text-sm">{account.username}</div>
            <div className="text-xs text-slate-400">
              {t.playerProfileTitle || 'Player Profile'}
            </div>
          </div>
        )}

        {/* Discord-Style Compact Profile Card Popout */}
        <ProfileCard
          isOpen={isProfileCardOpen}
          onClose={() => setIsProfileCardOpen(false)}
          account={account}
          onUpdateAccount={(updated) => {
            if (onUpdateAccount) onUpdateAccount(updated);
          }}
          onNavigateSkin={() => {
            setIsProfileCardOpen(false);
            onTabChange('skin');
          }}
          language={language}
        />
      </div>
    </aside>
  );
};

export default Sidebar;
