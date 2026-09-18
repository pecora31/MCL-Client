import React from 'react';
import mclLogo from '../../assets/logo.png';
import { Home, Layers, Package, Shirt, Server, Settings } from 'lucide-react';
import type { Account } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';
import { P2PFloatingWidget } from '../p2p/P2PFloatingWidget';

export type NavigationTab = 'home' | 'instances' | 'mods' | 'skin' | 'hostServer' | 'settings' | 'profile';

interface SidebarProps {
  currentTab: NavigationTab;
  onTabChange: (tab: NavigationTab) => void;
  account?: Account;
  onUpdateUsername?: (newName: string) => void;
  onUpdateAccount?: (updated: Account) => void;
  language: Language;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  language,
}) => {
  const t = getTranslation(language);

  const navItems = [
    { id: 'home', label: t.navHome, icon: Home },
    { id: 'instances', label: t.navInstances, icon: Layers },
    { id: 'mods', label: t.navMods, icon: Package },
    { id: 'skin', label: t.navSkin, icon: Shirt },
    { id: 'hostServer', label: t.navHostServer || 'Host Server', icon: Server },
    { id: 'settings', label: t.navSettings, icon: Settings },
  ];

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
                  onClick={() => onTabChange(item.id as NavigationTab)}
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

      {/* Bottom Cluster: P2P Multiplayer Room Hub */}
      <div className="w-full flex flex-col items-center pb-3 pt-2">
        {/* P2P Multiplayer Room Hub Button -> Opens Discord-Style Compact Popout */}
        <P2PFloatingWidget language={language} />
      </div>
    </aside>
  );
};

export default Sidebar;
