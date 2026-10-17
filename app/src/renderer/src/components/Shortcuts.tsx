// Every key the app answers to, in one place (Ctrl / or the command palette opens it).
import { Keyboard } from 'lucide-react';
import { Modal } from './ui';
import { useApp, PAGES } from '../store/app';
import { t, tk } from '@shared/i18n';

const PAGE_LABELS: Record<string, string> = {
  overview: tk('Genel bakış'),
  send: tk('Gönder'),
  compare: tk('Karşılaştır'),
  git: 'Git',
  sync: tk('Senkron'),
  automation: tk('Otomasyon'),
  targets: tk('Hedefler'),
  backups: tk('Yedekler'),
  history: tk('Geçmiş'),
  settings: tk('Ayarlar'),
};

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
/** The modifier key as the platform names it. */
export const MOD = isMac ? '⌘' : 'Ctrl';

interface Row {
  /** Alternatives; each one a list of key caps pressed together. */
  keys: string[][];
  what: string;
}

export function ShortcutsModal() {
  const open = useApp((s) => s.shortcuts);
  if (!open) return null;
  const close = () => useApp.setState({ shortcuts: false });
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: t('Genel'),
      rows: [
        { keys: [[MOD, 'K']], what: t('Komut paleti') },
        { keys: [[MOD, '/']], what: t('Bu liste') },
        { keys: [[MOD, ',']], what: t('Ayarlar') },
        { keys: [[MOD, '+'], [MOD, '−']], what: t('Arayüzü büyüt / küçült') },
        { keys: [[MOD, '0']], what: t('Arayüz ölçeğini sıfırla') },
        { keys: [['Esc']], what: t('Açık pencereyi, paleti ya da paneli kapat') },
        { keys: [['F12']], what: t('Geliştirici araçları') },
      ],
    },
    {
      title: t('Sayfalar'),
      rows: PAGES.map((p, i) => ({ keys: [[MOD, String(i + 1)]], what: t(PAGE_LABELS[p]) })),
    },
    {
      title: t('Gönderim'),
      rows: [
        { keys: [[MOD, 'Enter']], what: t('Gönder sayfasında incele; incelemede gönder') },
        { keys: [[MOD, 'Shift', 'Enter']], what: t('İncelemede deneme (yazmadan) başlat') },
        { keys: [[t('Sürükle-bırak')]], what: t('Pencereye bırakılan dosyalar gönderim listesine eklenir') },
      ],
    },
  ];
  return (
    <Modal
      title={t('Klavye kısayolları')}
      icon={
        <div className="icon-tile accent">
          <Keyboard size={16} />
        </div>
      }
      onClose={close}
    >
      <div className="shortcut-groups">
        {groups.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            {g.rows.map((r, i) => (
              <div key={i} className="shortcut-row">
                <span className="shortcut-keys">
                  {r.keys.map((combo, j) => (
                    <span key={j} className="shortcut-combo">
                      {j > 0 && <span className="faint">/</span>}
                      {combo.map((k) => (
                        <span key={k} className="kbd">
                          {k}
                        </span>
                      ))}
                    </span>
                  ))}
                </span>
                <span className="muted">{r.what}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
