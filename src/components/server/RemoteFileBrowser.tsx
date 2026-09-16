import React, { useEffect, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File as FileIcon,
  FolderPlus,
  Upload,
  Pencil,
  Trash2,
  Download,
  Save,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { remoteAgent, type RemoteHost } from '../../services/remoteAgent';
import { invokeCommand } from '../../services/api';
import type { RemoteFileEntry } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';

const TEXT_EDIT_SIZE_CAP = 1024 * 1024; // 1 MB

interface RemoteFileBrowserProps {
  host: RemoteHost;
  language: Language;
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface TreeNodeProps {
  host: RemoteHost;
  path: string;
  name: string;
  depth: number;
  expanded: Set<string>;
  children_: Record<string, RemoteFileEntry[]>;
  selectedFolder: string;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}

const TreeNode: React.FC<TreeNodeProps> = ({ host, path, name, depth, expanded, children_, selectedFolder, onToggle, onSelect }) => {
  const isExpanded = expanded.has(path);
  const isSelected = selectedFolder === path;
  const kids = (children_[path] || []).filter((e) => e.isDir);

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 rounded-lg cursor-pointer text-xs ${
          isSelected ? 'bg-[var(--accent-color)]/15 text-[var(--accent-color)]' : 'text-slate-300 hover:bg-white/5'
        }`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => onSelect(path)}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(path);
          }}
          className="p-0.5 shrink-0 text-slate-500 hover:text-white cursor-pointer"
        >
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        {isExpanded ? <FolderOpen className="w-3.5 h-3.5 shrink-0" /> : <Folder className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">{name || host.name}</span>
      </div>
      {isExpanded &&
        kids.map((child) => (
          <TreeNode
            key={joinPath(path, child.name)}
            host={host}
            path={joinPath(path, child.name)}
            name={child.name}
            depth={depth + 1}
            expanded={expanded}
            children_={children_}
            selectedFolder={selectedFolder}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
};

export const RemoteFileBrowser: React.FC<RemoteFileBrowserProps> = ({ host, language }) => {
  const t = getTranslation(language);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [childrenByPath, setChildrenByPath] = useState<Record<string, RemoteFileEntry[]>>({});
  const [selectedFolder, setSelectedFolder] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const loadFolder = async (path: string) => {
    try {
      const entries = await remoteAgent.listFiles(host, path);
      setChildrenByPath((prev) => ({ ...prev, [path]: entries }));
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    setExpanded(new Set(['']));
    setChildrenByPath({});
    setSelectedFolder('');
    loadFolder('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.id]);

  const toggleExpand = async (path: string) => {
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      if (!childrenByPath[path]) await loadFolder(path);
    }
    setExpanded(next);
  };

  const selectFolder = async (path: string) => {
    setSelectedFolder(path);
    if (!childrenByPath[path]) await loadFolder(path);
  };

  const refreshCurrent = () => loadFolder(selectedFolder);

  const handleNewFolder = async () => {
    const name = window.prompt(t.hostServerNewFolderPrompt || 'New folder name:');
    if (!name || !name.trim()) return;
    try {
      await remoteAgent.mkdir(host, joinPath(selectedFolder, name.trim()));
      await refreshCurrent();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleUpload = async () => {
    const localPath = await invokeCommand<string | null>('select_file', { filterName: null, filterExtensions: null });
    if (!localPath) return;
    const name = localPath.split(/[\\/]/).pop() || 'file';
    setIsUploading(true);
    try {
      await remoteAgent.uploadFile(host, localPath, joinPath(selectedFolder, name));
      await refreshCurrent();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsUploading(false);
    }
  };

  const handleRename = async (entry: RemoteFileEntry) => {
    const newName = window.prompt(t.hostServerRenamePrompt || 'New name:', entry.name);
    if (!newName || !newName.trim() || newName.trim() === entry.name) return;
    try {
      await remoteAgent.renameFile(host, joinPath(selectedFolder, entry.name), joinPath(selectedFolder, newName.trim()));
      await refreshCurrent();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDelete = async (entry: RemoteFileEntry) => {
    const template = entry.isDir
      ? t.hostServerDeleteFolderConfirm || 'Delete "{name}" and everything inside it? This cannot be undone.'
      : t.hostServerDeleteFileConfirm || 'Delete "{name}"? This cannot be undone.';
    if (!window.confirm(template.replace('{name}', entry.name))) return;
    try {
      await remoteAgent.deleteFile(host, joinPath(selectedFolder, entry.name));
      await refreshCurrent();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleDownload = async (entry: RemoteFileEntry) => {
    const savePath = await invokeCommand<string | null>('select_save_path', { defaultName: entry.name });
    if (!savePath) return;
    try {
      await remoteAgent.downloadFile(host, joinPath(selectedFolder, entry.name), savePath);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleOpen = async (entry: RemoteFileEntry) => {
    if (entry.isDir) {
      await selectFolder(joinPath(selectedFolder, entry.name));
      return;
    }
    if (entry.sizeBytes > TEXT_EDIT_SIZE_CAP) {
      await handleDownload(entry);
      return;
    }
    const path = joinPath(selectedFolder, entry.name);
    try {
      const content = await remoteAgent.readTextFile(host, path);
      setEditing({ path, content });
    } catch {
      // Not valid UTF-8, or some other read failure — offer a download instead of erroring.
      await handleDownload(entry);
    }
  };

  const handleSaveEditing = async () => {
    if (!editing) return;
    setIsSaving(true);
    try {
      await remoteAgent.writeTextFile(host, editing.path, editing.content);
      setEditing(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const currentEntries = childrenByPath[selectedFolder] || [];

  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.06] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">{t.hostServerFilesTitle || 'Files'}</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleNewFolder}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title={t.hostServerNewFolder || 'New folder'}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={isUploading}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer disabled:opacity-40"
            title={t.hostServerUpload || 'Upload'}
          >
            {isUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 flex items-center gap-2 text-xs text-rose-300 bg-rose-500/10 border-b border-rose-500/20">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      <div className="flex" style={{ height: '20rem' }}>
        <div className="w-48 shrink-0 border-r border-white/[0.06] overflow-y-auto custom-scrollbar py-2">
          <TreeNode
            host={host}
            path=""
            name=""
            depth={0}
            expanded={expanded}
            children_={childrenByPath}
            selectedFolder={selectedFolder}
            onToggle={toggleExpand}
            onSelect={selectFolder}
          />
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-white/5">
          {currentEntries.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-500">{t.hostServerEmptyFolder || 'Empty folder.'}</p>
          ) : (
            currentEntries.map((entry) => (
              <div
                key={entry.name}
                className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-white/5 cursor-pointer group"
                onClick={() => handleOpen(entry)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {entry.isDir ? (
                    <Folder className="w-3.5 h-3.5 shrink-0 text-[var(--accent-color)]" />
                  ) : (
                    <FileIcon className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  )}
                  <span className="truncate text-slate-200">{entry.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!entry.isDir && <span className="text-slate-500 font-mono">{formatSize(entry.sizeBytes)}</span>}
                  <div className="hidden group-hover:flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRename(entry);
                      }}
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                      title={t.hostServerRename || 'Rename'}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    {!entry.isDir && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(entry);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                        title={t.hostServerDownloadFile || 'Download'}
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(entry);
                      }}
                      className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                      title={t.hostServerDeleteFile || 'Delete'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8">
          <div className="w-full max-w-2xl h-[70vh] rounded-2xl bg-[#151515] border border-white/10 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <span className="text-xs font-mono text-slate-300 truncate">{editing.path}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveEditing}
                  disabled={isSaving}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--accent-color)] text-black flex items-center gap-1.5 cursor-pointer active:scale-95 transition disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{t.saveBtn || 'Save'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <textarea
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              spellCheck={false}
              className="flex-1 w-full p-4 bg-transparent text-xs font-mono text-slate-200 resize-none focus:outline-none"
            />
          </div>
        </div>
      )}
    </div>
  );
};
