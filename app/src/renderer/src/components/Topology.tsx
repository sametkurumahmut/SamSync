// The machines as a picture: this computer on the left, the groups on the right, a line to each group
// coloured by how many of its machines answer, the relay marked and dashed lines from it to the machines
// it distributes to. Click a machine to pick it as a send target; drag it into another group to move it.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Laptop, Share2, Wifi, WifiOff, Check } from 'lucide-react';
import type { NodeConfig } from '@shared/types';
import { useApp } from '../store/app';
import { cls } from '../lib/format';
import { t } from '@shared/i18n';

const NODE_W = 152;
const NODE_H = 46;
const GAP = 10;
const PAD = 12;
const TITLE_H = 30;
const BOX_X = 236;
const LAPTOP_W = 170;
const LAPTOP_H = 64;

interface GroupBox {
  key: string;
  name: string;
  members: NodeConfig[];
  x: number;
  y: number;
  w: number;
  h: number;
  ok: number;
  down: number;
}

interface Layout {
  boxes: GroupBox[];
  pos: Map<string, { x: number; y: number }>;
  height: number;
  laptop: { x: number; y: number };
}

function layout(groups: { key: string; name: string; members: NodeConfig[] }[], width: number, probes: Record<string, { ok: boolean } | undefined>): Layout {
  const boxW = Math.max(NODE_W + 2 * PAD, width - BOX_X - 8);
  const cols = Math.max(1, Math.floor((boxW - 2 * PAD + GAP) / (NODE_W + GAP)));
  const pos = new Map<string, { x: number; y: number }>();
  const boxes: GroupBox[] = [];
  let y = 8;
  for (const g of groups) {
    const rows = Math.max(1, Math.ceil(g.members.length / cols));
    const h = TITLE_H + rows * (NODE_H + GAP) - GAP + 2 * PAD;
    const box: GroupBox = { key: g.key, name: g.name, members: g.members, x: BOX_X, y, w: boxW, h, ok: 0, down: 0 };
    g.members.forEach((n, i) => {
      const r = Math.floor(i / cols);
      const c = i % cols;
      pos.set(n.id, { x: BOX_X + PAD + c * (NODE_W + GAP), y: y + TITLE_H + PAD + r * (NODE_H + GAP) });
      const p = probes[n.id];
      if (p?.ok) box.ok++;
      else if (p) box.down++;
    });
    boxes.push(box);
    y += h + 14;
  }
  const height = Math.max(y - 14 + 8, LAPTOP_H + 16);
  return { boxes, pos, height, laptop: { x: 8, y: Math.max(8, height / 2 - LAPTOP_H / 2) } };
}

export function Topology({ compact }: { compact?: boolean }) {
  const cfg = useApp((s) => s.boot!.config);
  const identity = useApp((s) => s.boot!.identity);
  const probes = useApp((s) => s.probes);
  const targets = useApp((s) => s.targets);
  const setTargets = useApp((s) => s.setTargets);
  const saveConfig = useApp((s) => s.saveConfig);
  const toast = useApp((s) => s.toast);
  const configWritable = useApp((s) => s.boot!.configWritable);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const localId = identity.node?.id;
  const groups = useMemo(() => {
    const m = new Map<string, NodeConfig[]>();
    for (const n of cfg.nodes) {
      if (n.id === localId) continue;
      const k = n.group ? n.group.toLowerCase() : '';
      m.set(k, [...(m.get(k) ?? []), n]);
    }
    const list = [...m.entries()].map(([key, members]) => ({ key, name: key ? members[0].group! : t('Gruba ait olmayanlar'), members: [...members].sort((a, b) => Number(!!b.relay) - Number(!!a.relay)) }));
    return [...list.filter((g) => g.key).sort((a, b) => a.name.localeCompare(b.name)), ...list.filter((g) => !g.key)];
  }, [cfg.nodes, localId]);

  const lay = useMemo(() => layout(groups, width, probes), [groups, width, probes]);
  const selected = new Set(targets);

  const toSvg = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const boxAt = (x: number, y: number) => lay.boxes.find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null;

  const onDown = (n: NodeConfig) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const p = toSvg(e);
    setDrag({ id: n.id, x: p.x, y: p.y, moved: false });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const p = toSvg(e);
    const moved = drag.moved || Math.hypot(p.x - drag.x, p.y - drag.y) > 6;
    setDrag({ ...drag, x: p.x, y: p.y, moved });
    if (moved) setOver(boxAt(p.x, p.y)?.key ?? null);
  };
  const onUp = async (e: ReactPointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    setOver(null);
    const node = cfg.nodes.find((n) => n.id === d.id);
    if (!node) return;
    if (!d.moved) {
      // a click: pick or drop it as a send target
      setTargets(selected.has(node.id) ? targets.filter((x) => x !== node.id) : [...targets, node.id]);
      return;
    }
    const p = toSvg(e);
    const box = boxAt(p.x, p.y);
    if (!box) return;
    const current = node.group ? node.group.toLowerCase() : '';
    if (box.key === current) return;
    if (!configWritable) return toast('warn', t('Yapılandırma salt okunur'));
    const groupName = box.key ? box.members[0]?.group ?? box.name : undefined;
    if (!confirm(groupName ? t('{name} makinesi {group} grubuna taşınsın mı?', { name: node.name, group: groupName }) : t('{name} makinesi gruptan çıkarılsın mı?', { name: node.name }))) return;
    const next = cfg.nodes.map((n) => (n.id === node.id ? { ...n, group: groupName, relay: groupName ? n.relay : undefined } : n));
    if (await saveConfig({ ...cfg, nodes: next })) toast('ok', groupName ? t('{name} → {group}', { name: node.name, group: groupName }) : t('{name} gruptan çıkarıldı', { name: node.name }));
  };

  const groupTone = (b: GroupBox) => (b.members.length === 0 ? '' : b.ok === b.members.length ? 'ok' : b.ok === 0 && b.down > 0 ? 'bad' : b.down > 0 ? 'warn' : '');
  const laptopCx = lay.laptop.x + LAPTOP_W;
  const laptopCy = lay.laptop.y + LAPTOP_H / 2;

  return (
    <div ref={ref} className={cls('topology', compact && 'compact', drag?.moved && 'dragging')} style={{ height: lay.height }} onPointerMove={onMove} onPointerUp={(e) => void onUp(e)} onPointerCancel={() => (setDrag(null), setOver(null))}>
      <svg className="topology-lines" width="100%" height={lay.height} aria-hidden="true">
        {lay.boxes.map((b) => {
          const x2 = b.x;
          const y2 = b.y + Math.min(b.h / 2, TITLE_H + PAD + NODE_H / 2);
          const mx = (laptopCx + x2) / 2;
          const tone = groupTone(b);
          return <path key={b.key} d={`M${laptopCx},${laptopCy} C${mx},${laptopCy} ${mx},${y2} ${x2},${y2}`} className={cls('topo-link', tone)} />;
        })}
        {lay.boxes.flatMap((b) => {
          const relay = b.members.find((n) => n.relay);
          if (!relay || b.members.length < 2) return [];
          const r = lay.pos.get(relay.id)!;
          const alive = probes[relay.id]?.relayAlive;
          return b.members
            .filter((n) => n.id !== relay.id)
            .map((n) => {
              const p = lay.pos.get(n.id)!;
              return <path key={`${relay.id}-${n.id}`} d={`M${r.x + NODE_W / 2},${r.y + NODE_H / 2} L${p.x + NODE_W / 2},${p.y + NODE_H / 2}`} className={cls('topo-relay', alive === false && 'off')} />;
            });
        })}
      </svg>

      <div className="topo-laptop" style={{ left: lay.laptop.x, top: lay.laptop.y, width: LAPTOP_W, height: LAPTOP_H }}>
        <div className="icon-tile accent">
          <Laptop size={16} />
        </div>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ fontWeight: 640 }}>
            {identity.node?.name ?? t('Bu makine')}
          </div>
          <div className="faint ellipsis" style={{ fontSize: 11 }}>
            {identity.node ? identity.node.id : t('Tanımsız makine')}
          </div>
        </div>
      </div>

      {lay.boxes.map((b) => (
        <div key={b.key} className={cls('topo-group', groupTone(b), over === b.key && 'over')} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
          <div className="topo-group-title">
            <span className={b.key ? 'keep-case' : undefined}>{b.name}</span>
            <span className="faint tabular">
              {b.ok}/{b.members.length}
            </span>
            {b.members.some((n) => n.relay) && (
              <span className="badge violet" style={{ marginLeft: 'auto' }}>
                <Share2 size={10} /> {t('röle')}
              </span>
            )}
          </div>
        </div>
      ))}

      {lay.boxes.flatMap((b) =>
        b.members.map((n) => {
          const p = lay.pos.get(n.id)!;
          const pr = probes[n.id];
          const isDrag = drag?.id === n.id && drag.moved;
          const x = isDrag ? drag.x - NODE_W / 2 : p.x;
          const y = isDrag ? drag.y - NODE_H / 2 : p.y;
          return (
            <div
              key={n.id}
              className={cls('topo-node', selected.has(n.id) && 'selected', !n.enabled && 'disabled', isDrag && 'ghost', n.relay && 'relay')}
              style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
              onPointerDown={onDown(n)}
              title={pr ? pr.detail : t('Henüz yoklanmadı')}
            >
              <span className={cls('dot', pr ? (pr.ok ? 'ok' : 'bad') : 'pending')} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis" style={{ fontWeight: 600, fontSize: 12.5 }}>
                  {n.name}
                </div>
                <div className="faint ellipsis row" style={{ fontSize: 10.5, gap: 4 }}>
                  {pr ? pr.ok ? <Wifi size={10} /> : <WifiOff size={10} /> : null}
                  {pr?.ok && pr.latencyMs != null ? `${pr.latencyMs} ms` : pr ? t('erişilemedi') : n.id}
                  {n.relay && <Share2 size={10} className={pr?.relayAlive === false ? 'faint' : undefined} />}
                </div>
              </div>
              {selected.has(n.id) && (
                <span className="topo-check">
                  <Check size={11} />
                </span>
              )}
            </div>
          );
        }),
      )}
    </div>
  );
}
