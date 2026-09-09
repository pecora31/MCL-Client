import React, { useEffect, useState } from 'react';
import { Shield, Clock, HardDrive, Edit3, Check, Upload, Shirt, Trash2, Award, Zap, Heart, Skull, Swords, Pickaxe, Footprints, Hammer, Globe2 } from 'lucide-react';
import type { Account, GameInstance, InstanceStats } from '../../types';
import { getInstanceStats } from '../../services/api';
import { getTranslation, type Language } from '../../locales/i18n';

interface ProfileViewProps {
  account: Account;
  onUpdateAccount: (updated: Account) => void;
  onNavigateSkin: () => void;
  instances: GameInstance[];
  language: Language;
}

const EMPTY_STATS: InstanceStats = {
  trackedPlayMinutes: 0,
  inGamePlayMinutes: 0,
  deaths: 0,
  mobKills: 0,
  playerKills: 0,
  blocksMined: 0,
  itemsCrafted: 0,
  distanceWalkedKm: 0,
  jumps: 0,
  worlds: [],
};

function formatPlayTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours < 10 ? `${hours.toFixed(1)} hrs` : `${Math.round(hours)} hrs`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toString();
}

/// The loader the player actually reaches for, rather than a fixed recommendation.
function mostUsedLoader(instances: GameInstance[]): string | null {
  const counts = new Map<string, number>();
  for (const instance of instances) {
    if (instance.loader === 'vanilla') continue;
    counts.set(instance.loader, (counts.get(instance.loader) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [loader, count] of counts) {
    if (count > bestCount) {
      best = loader;
      bestCount = count;
    }
  }
  return best;
}

// Preset Minecraft Icons
export const MINECRAFT_AVATAR_ICONS = [
  { id: 'creeper', name: 'Creeper', color: 'from-emerald-500 to-green-700', icon: '🟢', desc: 'Classic Icon' },
  { id: 'diamond_sword', name: 'Diamond Sword', color: 'from-cyan-400 to-blue-600', icon: '⚔️', desc: 'Warrior Sword' },
  { id: 'netherite_helmet', name: 'Netherite Helmet', color: 'from-slate-700 to-zinc-900', icon: '🛡️', desc: 'Ancient Armor' },
  { id: 'golden_apple', name: 'Golden Apple', color: 'from-amber-300 to-yellow-500', icon: '🍏', desc: 'Legendary Food' },
  { id: 'totem', name: 'Totem of Undying', color: 'from-amber-400 to-emerald-500', icon: '🗿', desc: 'Resurrection Relic' },
  { id: 'enderman', name: 'Enderman', color: 'from-purple-900 to-indigo-950', icon: '👁️', desc: 'Dimensional Traveler' },
  { id: 'enchanted_book', name: 'Enchanted Book', color: 'from-purple-500 to-pink-600', icon: '📖', desc: 'Spell Tome' },
  { id: 'wolf', name: 'Tamed Wolf', color: 'from-stone-400 to-slate-600', icon: '🐺', desc: 'Loyal Companion' },
  { id: 'redstone', name: 'Redstone Core', color: 'from-red-500 to-rose-700', icon: '⚡', desc: 'Automation Engineer' },
  { id: 'emerald', name: 'Emerald Gem', color: 'from-emerald-400 to-teal-600', icon: '💎', desc: 'Wealthy Merchant' },
  { id: 'tnt', name: 'TNT Explosive', color: 'from-red-600 to-rose-900', icon: '🧨', desc: 'Demolition Power' },
  { id: 'fire', name: 'Blaze Flame', color: 'from-orange-500 to-amber-600', icon: '🔥', desc: 'Nether Inferno' },
];

export const ProfileView: React.FC<ProfileViewProps> = ({
  account,
  onUpdateAccount,
  onNavigateSkin,
  instances,
  language,
}) => {
  const t = getTranslation(language);
  const [usernameInput, setUsernameInput] = useState(account.username);
  const [isEditingName, setIsEditingName] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [stats, setStats] = useState<InstanceStats>(EMPTY_STATS);

  // Minecraft writes these per world, so the totals only add up once every profile has been
  // read. They are all local file reads, and a profile that has never been played simply
  // contributes zeros.
  useEffect(() => {
    let cancelled = false;

    const loadStats = async () => {
      const totals: InstanceStats = { ...EMPTY_STATS, worlds: [] };

      for (const instance of instances) {
        try {
          const instanceStats = await getInstanceStats(instance.id);
          totals.trackedPlayMinutes += instanceStats.trackedPlayMinutes;
          totals.inGamePlayMinutes += instanceStats.inGamePlayMinutes;
          totals.deaths += instanceStats.deaths;
          totals.mobKills += instanceStats.mobKills;
          totals.playerKills += instanceStats.playerKills;
          totals.blocksMined += instanceStats.blocksMined;
          totals.itemsCrafted += instanceStats.itemsCrafted;
          totals.distanceWalkedKm += instanceStats.distanceWalkedKm;
          totals.jumps += instanceStats.jumps;
          totals.worlds.push(...instanceStats.worlds);
        } catch (err) {
          console.warn(`Could not read statistics for '${instance.name}':`, err);
        }
      }

      totals.worlds.sort((a, b) => b.playTimeMinutes - a.playTimeMinutes);
      if (!cancelled) setStats(totals);
    };

    loadStats();
    return () => {
      cancelled = true;
    };
  }, [instances]);

  const topLoader = mostUsedLoader(instances);

  const handleSaveName = () => {
    if (!usernameInput.trim()) return;
    const updated = { ...account, username: usernameInput.trim() };
    onUpdateAccount(updated);
    setIsEditingName(false);
    showSuccess();
  };

  const handleSelectPresetIcon = (iconId: string) => {
    const updated: Account = {
      ...account,
      avatarIcon: iconId,
      avatarCustom: undefined,
    };
    onUpdateAccount(updated);
    showSuccess();
  };

  const handleUploadCustomAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const updated: Account = {
          ...account,
          avatarCustom: reader.result,
          avatarIcon: undefined,
        };
        onUpdateAccount(updated);
        showSuccess();
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveCustomAvatar = () => {
    const updated: Account = {
      ...account,
      avatarCustom: undefined,
      avatarIcon: 'creeper',
    };
    onUpdateAccount(updated);
    showSuccess();
  };

  const showSuccess = () => {
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const currentPreset = MINECRAFT_AVATAR_ICONS.find((i) => i.id === (account.avatarIcon || 'creeper')) || MINECRAFT_AVATAR_ICONS[0];

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-10 space-y-7 animate-fadeIn custom-scrollbar">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pr-12">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold mb-2 tracking-wide">
            <Shield className="w-4 h-4" />
            <span>{t.badgeProfile || 'Player Profile'}</span>
          </div>
          <h1 className="text-3xl font-extrabold font-riot text-white tracking-normal">
            {t.playerProfileTitle || 'Player Profile'}
          </h1>
          <p className="text-base text-slate-300 mt-1 tracking-wide">
            {t.playerProfileSub || 'Manage account identity, player badge and custom avatar'}
          </p>
        </div>
      </div>

      {/* Top Banner & Player Identity Card */}
      <div className="minimal-panel rounded-2xl p-6 border border-white/[0.06] shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-amber-500/10 via-indigo-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          {/* Avatar & Name Info */}
          <div className="flex items-center gap-5">
            {/* Big Avatar Frame */}
            <div className="relative group">
              <div className="w-24 h-24 rounded-2xl overflow-hidden bg-slate-900 border-[2.5px] border-[var(--accent-color)] shadow-lg shadow-black/40 flex items-center justify-center text-4xl">
                {account.avatarCustom ? (
                  <img src={account.avatarCustom} alt={account.username} className="w-full h-full object-cover" />
                ) : (
                  <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${currentPreset.color}`}>
                    <span className="drop-shadow-md select-none">{currentPreset.icon}</span>
                  </div>
                )}
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-slate-950 flex items-center justify-center" title="Online">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              </div>
            </div>

            {/* Name, Tag & UUID */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                {isEditingName ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                      className="px-3 py-1.5 rounded-xl bg-[#181818] border border-white/20 text-base font-bold text-white font-riot tracking-wide focus:outline-none focus:border-amber-400"
                      autoFocus
                    />
                    <button
                      onClick={handleSaveName}
                      className="p-2 rounded-xl bg-amber-500 text-slate-950 hover:bg-amber-400 transition"
                    >
                      <Check className="w-4 h-4 font-bold" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-black font-riot text-white tracking-wide">{account.username}</h1>
                    <button
                      onClick={() => setIsEditingName(true)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition"
                      title="Edit username"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/40 font-riot">
                  {account.type.toUpperCase()}
                </span>
              </div>

              <p className="text-xs text-slate-400 font-mono">UUID: {account.uuid.slice(0, 18)}...</p>

              <div className="flex items-center gap-3 pt-1 text-xs text-slate-300">
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <Shield className="w-3.5 h-3.5" /> Ready to Play
                </span>
                <span>•</span>
                <span className="text-slate-400">Skin Model: <strong className="text-slate-200 capitalize">{account.skinModel}</strong></span>
              </div>
            </div>
          </div>

          {/* Quick Actions on Right */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={onNavigateSkin}
              className="px-5 py-2.5 rounded-xl bg-[#181818] hover:bg-[#222222] text-white font-bold text-xs flex items-center gap-2 border border-white/[0.08] transition shadow-lg font-riot tracking-wide uppercase"
            >
              <Shirt className="w-4 h-4 text-amber-400" />
              <span>Edit 3D Skin</span>
            </button>
          </div>
        </div>

        {savedSuccess && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2 animate-fadeIn">
            <Check className="w-4 h-4" />
            <span>Profile information updated successfully!</span>
          </div>
        )}
      </div>

      {/* Main Grid: Avatar Gallery (Left) & Player Stats (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Avatar Picker (8 cols) */}
        <div className="lg:col-span-8 minimal-panel rounded-2xl p-6 border border-white/[0.06] space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
            <div>
              <h2 className="text-base font-bold text-white font-riot tracking-wide flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-400" />
                <span>Player Avatar Icons</span>
              </h2>
              <p className="text-xs text-slate-400">Select a signature Minecraft avatar or upload a custom image</p>
            </div>

            {/* Upload Custom Avatar Button */}
            <div className="flex items-center gap-2">
              <label className="px-4 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-semibold text-xs cursor-pointer flex items-center gap-1.5 transition font-riot">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Avatar</span>
                <input type="file" accept="image/png, image/jpeg, image/webp" onChange={handleUploadCustomAvatar} className="hidden" />
              </label>

              {account.avatarCustom && (
                <button
                  onClick={handleRemoveCustomAvatar}
                  className="p-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition"
                  title="Remove custom image and reset to icon"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Minecraft Preset Icons Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {MINECRAFT_AVATAR_ICONS.map((item) => {
              const isSelected = !account.avatarCustom && (account.avatarIcon || 'creeper') === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelectPresetIcon(item.id)}
                  className={`p-3.5 rounded-xl border-2 text-left transition-all duration-150 flex items-center gap-3 group relative cursor-pointer ${
                    isSelected
                      ? 'bg-theme-selected border-[var(--accent-color)] text-white shadow-md shadow-black/30 -translate-y-0.5'
                      : 'bg-[#141414] border-white/[0.06] text-slate-300 hover:border-white/20 hover:bg-[#1c1c1c] hover:-translate-y-0.5'
                  }`}
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl bg-gradient-to-br ${item.color} shadow-sm transition shrink-0`}>
                    <span className="select-none">{item.icon}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white truncate font-riot tracking-wide">{item.name}</div>
                    <div className="text-xs text-slate-400 truncate mt-0.5">{item.desc}</div>
                  </div>
                  {isSelected && (
                    <div className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-[var(--accent-color)]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Player Stats & Information (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="minimal-panel rounded-2xl p-6 border border-white/[0.06] space-y-4">
            <h3 className="text-sm font-bold text-white font-riot tracking-wide flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" />
              <span>Player Statistics</span>
            </h3>

            <div className="space-y-3">
              <div className="p-3 rounded-2xl bg-black/30 border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <span>Total Play Time:</span>
                </div>
                <span className="font-mono text-xs font-bold text-white">
                  {formatPlayTime(stats.trackedPlayMinutes)}
                </span>
              </div>

              <div className="p-3 rounded-2xl bg-black/30 border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <HardDrive className="w-4 h-4 text-emerald-400" />
                  <span>Saved Profiles:</span>
                </div>
                <span className="font-mono text-xs font-bold text-white">{instances.length} Profiles</span>
              </div>

              <div className="p-3 rounded-2xl bg-black/30 border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  <span>Most Used Loader:</span>
                </div>
                <span className="font-mono text-xs font-bold text-cyan-300">
                  {topLoader ? topLoader.charAt(0).toUpperCase() + topLoader.slice(1) : 'Vanilla'}
                </span>
              </div>
            </div>
          </div>

          {/* Numbers Minecraft recorded itself, so they cover singleplayer worlds only */}
          <div className="minimal-panel rounded-2xl p-6 border border-white/[0.06] space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white font-riot tracking-wide flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-emerald-400" />
                <span>In-Game Records</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-1">
                Read from your singleplayer worlds &mdash; server play is recorded by the server.
              </p>
            </div>

            {stats.worlds.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No world statistics yet. Play a singleplayer world and they will show up here.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { icon: Clock, color: 'text-amber-400', label: 'In-game time', value: formatPlayTime(stats.inGamePlayMinutes) },
                    { icon: Swords, color: 'text-rose-400', label: 'Mobs killed', value: formatCount(stats.mobKills) },
                    { icon: Pickaxe, color: 'text-cyan-400', label: 'Blocks mined', value: formatCount(stats.blocksMined) },
                    { icon: Hammer, color: 'text-orange-400', label: 'Items crafted', value: formatCount(stats.itemsCrafted) },
                    { icon: Footprints, color: 'text-emerald-400', label: 'Distance walked', value: `${stats.distanceWalkedKm.toFixed(1)} km` },
                    { icon: Skull, color: 'text-slate-300', label: 'Deaths', value: formatCount(stats.deaths) },
                  ].map((entry) => (
                    <div key={entry.label} className="p-3 rounded-2xl bg-black/30 border border-white/5">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <entry.icon className={`w-3.5 h-3.5 ${entry.color}`} />
                        <span className="truncate">{entry.label}</span>
                      </div>
                      <div className="font-mono text-sm font-bold text-white mt-1">{entry.value}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Most played worlds
                  </div>
                  {stats.worlds.slice(0, 4).map((world) => (
                    <div
                      key={`${world.worldName}-${world.playTimeMinutes}`}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-black/20 border border-white/5"
                    >
                      <span className="text-xs text-slate-300 truncate">{world.worldName}</span>
                      <span className="font-mono text-[11px] text-slate-400 shrink-0">
                        {formatPlayTime(world.playTimeMinutes)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="rounded-3xl p-5 bg-gradient-to-br from-indigo-950/40 via-slate-900/60 to-purple-950/30 border border-indigo-500/20 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
              <Heart className="w-4 h-4 text-rose-400" />
              <span>In-Game Skin Sync</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Custom skins automatically sync with fellow players on community servers without needing an official Mojang subscription.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
