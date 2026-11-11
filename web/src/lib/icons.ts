import { html, svg, type TemplateResult } from 'lit';
import { unsafeSVG } from 'lit/directives/unsafe-svg.js';
import {
  Search, BookOpen, ChevronRight, ChevronDown, Moon, Sun, Monitor, Bookmark, BookmarkCheck, Link, Download,
  ArrowLeft, ArrowRight, Menu, X, Layers, FileText, Hash, Clock, Command, CornerDownLeft, ListTree, Copy, Check,
  ExternalLink, Library, History, PanelLeftClose, PanelLeft, ChevronsDownUp, ChevronsUpDown, Image, SearchX,
  Info, Quote, Minus, Plus, ArrowUpRight, TextSearch, Radio, Network, ShieldCheck, Smartphone, Server, Cpu,
  Waypoints, Folder, AudioLines, Database, Settings, Signal, TestTubeDiagonal, Lock, Rows3, Tag, CornerLeftUp,
  Share2,
} from 'lucide';

type IconNode = [string, Record<string, string | number>][];

const ICONS = {
  search: Search, book: BookOpen, chevronRight: ChevronRight, chevronDown: ChevronDown, moon: Moon, sun: Sun,
  monitor: Monitor, bookmark: Bookmark, bookmarkCheck: BookmarkCheck, link: Link, download: Download,
  arrowLeft: ArrowLeft, arrowRight: ArrowRight, menu: Menu, x: X, layers: Layers, file: FileText, hash: Hash,
  clock: Clock, command: Command, enter: CornerDownLeft, tree: ListTree, copy: Copy, check: Check,
  external: ExternalLink, library: Library, history: History, panelClose: PanelLeftClose, panel: PanelLeft,
  collapse: ChevronsDownUp, expand: ChevronsUpDown, image: Image, searchX: SearchX, info: Info, quote: Quote,
  minus: Minus, plus: Plus, arrowUpRight: ArrowUpRight, textSearch: TextSearch, radio: Radio, network: Network,
  shield: ShieldCheck, phone: Smartphone, server: Server, cpu: Cpu, waypoints: Waypoints, folder: Folder,
  audio: AudioLines, database: Database, settings: Settings, signal: Signal, test: TestTubeDiagonal, lock: Lock,
  rows: Rows3, tag: Tag, up: CornerLeftUp, refs: Share2,
} as const satisfies Record<string, unknown>;

export type IconName = keyof typeof ICONS;

const cache = new Map<string, TemplateResult>();

function nodeToSvg(n: IconNode): string {
  return n
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
    .join('');
}

/** <svg> template for a Lucide icon; decorative (aria-hidden) unless a label is passed */
export function icon(name: IconName, cls = '', label?: string): TemplateResult {
  const key = name + '|' + cls + '|' + (label ?? '');
  let t = cache.get(key);
  if (!t) {
    const inner = nodeToSvg(ICONS[name] as unknown as IconNode);
    t = html`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden=${label ? 'false' : 'true'} role=${label ? 'img' : 'presentation'}>${label ? svg`<title>${label}</title>` : ''}${unsafeSVG(inner)}</svg>`;
    cache.set(key, t);
  }
  return t;
}

/** icons for series (used on home / browse cards) */
export const SERIES_ICON: Record<string, IconName> = {
  '21': 'library', '22': 'layers', '23': 'network', '24': 'phone', '25': 'radio', '26': 'audio', '27': 'database',
  '28': 'settings', '29': 'server', '31': 'cpu', '32': 'settings', '33': 'shield', '34': 'test', '35': 'lock',
  '36': 'signal', '37': 'waypoints', '38': 'radio',
};
