// Settings › Agent: this machine receives what other SamSync instances send it as one compressed pack and applies
// it to its own disk, with commands of its own before and after (stop and start the program that holds the files).
import { useState } from 'react';
import { AlertTriangle, Radio, Terminal, Wrench } from 'lucide-react';
import type { AgentSettings } from '@shared/types';
import { useApp } from '../store/app';
import { Button, Field, ToggleRow } from './ui';
import { t } from '@shared/i18n';

const DEFAULTS: AgentSettings = { receivePacks: true, notifyOnApply: true };

/**
 * What keeps senders from seeing SamSync here (a first local root that is missing, or that is not the folder the share
 * leads to), with the fix when there is one: the share's folder becomes the first local root.
 */
export function AgentChecks() {
  const boot = useApp((s) => s.boot!);
  const checks = useApp((s) => s.relayState?.checks);
  const saveConfig = useApp((s) => s.saveConfig);
  const node = boot.identity.node;
  if (!checks?.length || !node) return null;
  const fix = async (root: string) => {
    if (!confirm(t('Bu makinenin ilk yerel kökü {old} yerine {root} olsun mu?', { old: node.localRoots[0] ?? '-', root }))) return;
    const roots = [root, ...node.localRoots.slice(1).filter((r) => r.toLowerCase() !== root.toLowerCase())];
    await saveConfig({ ...boot.config, nodes: boot.config.nodes.map((n) => (n.id === node.id ? { ...n, localRoots: roots } : n)) });
  };
  return (
    <div className="col" style={{ gap: 6, marginTop: 10 }}>
      {checks.map((c, i) => (
        <div key={i} className="row" style={{ gap: 6, fontSize: 12.5, alignItems: 'flex-start' }}>
          <AlertTriangle size={13} color={c.level === 'error' ? 'var(--red)' : 'var(--amber)'} style={{ marginTop: 2, flex: 'none' }} />
          <span className="grow selectable">{c.text}</span>
          {c.fixRoot && (
            <Button size="sm" icon={<Wrench size={12} />} disabled={!boot.configWritable} onClick={() => void fix(c.fixRoot!)} tip={t('İlk yerel kökü {root} yapar', { root: c.fixRoot })}>
              {t('Düzelt')}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

export function AgentSection({ Section }: { Section: (p: { id: string; icon: React.ReactNode; title: string; desc?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) => React.ReactElement }) {
  const boot = useApp((s) => s.boot!);
  const saveSettings = useApp((s) => s.saveSettings);
  const toast = useApp((s) => s.toast);
  const relayState = useApp((s) => s.relayState);
  const saved: AgentSettings = { ...DEFAULTS, ...(boot.settings.agent ?? {}) };
  const [a, setA] = useState<AgentSettings>(saved);
  const dirty = JSON.stringify(a) !== JSON.stringify(saved);
  const node = boot.identity.node;
  const root = node?.localRoots[0];
  return (
    <Section
      id="agent"
      icon={<Radio size={15} />}
      title={t('Ajan: bu makineye gelen paketler')}
      desc={t('Başka bir SamSync bu makineye gönderirken dosyalar sıkıştırılmış tek paket olarak gelir ve burada uygulanır')}
      action={
        dirty && (
          <Button size="sm" variant="primary" onClick={async () => (await saveSettings({ agent: a }), toast('ok', t('Ajan ayarları kaydedildi')))}>
            {t('Kaydet')}
          </Button>
        )
      }
    >
      {!node || !root ? (
        <p className="muted">{t('Bu bilgisayar yapılandırmada bir makine olarak tanımlı ve bir yerel kökü olmalı; paketler o kökün altındaki klasöre bırakılır.')}</p>
      ) : (
        <>
          <ToggleRow
            title={t('Paketleri al ve uygula')}
            desc={
              relayState?.active
                ? t('Çalışıyor: {dir} izleniyor', { dir: relayState.dir ?? root })
                : t('Kapalıyken gönderen taraf dosyaları paylaşım üzerinden tek tek yazar. Paket, ağ trafiğini yaklaşık yarıya indirir ve dosyalar burada yerel diskten uygulanır.')
            }
            on={a.receivePacks}
            onChange={(v) => setA({ ...a, receivePacks: v })}
          />
          <AgentChecks />
          <ToggleRow title={t('Paket uygulanınca bildir')} desc={t('Bu makinede masaüstü bildirimi: kim gönderdi, kaç dosya')} on={a.notifyOnApply} onChange={(v) => setA({ ...a, notifyOnApply: v })} />
          <ToggleRow
            title={t('Ağdan güncellemeyi kabul et')}
            desc={t('Başka bir SamSync bu makinenin paylaşımına daha yeni bir kurulum bırakınca burada iş bitince sessizce kurulur ve SamSync yeniden açılır. Paylaşıma yazabilen herkes kurulum bırakabilir; yalnızca güvendiğiniz ağda açın.')}
            on={a.acceptUpdates === true}
            onChange={(v) => setA({ ...a, acceptUpdates: v || undefined })}
          />
          <ToggleRow
            title={t('Gönderilen klasörleri izle (anlık sapma)')}
            desc={t('Gönderilen klasörlerde bir dosya elle değişince, eklenince ya da silinince gönderenlerin makine kartında hemen görünür; SamSync’in kendi gönderimleri sayılmaz.')}
            on={a.watchDrift === true}
            onChange={(v) => setA({ ...a, watchDrift: v || undefined })}
          />
          <ToggleRow
            title={t('Gönderenler dosyayı tutan programı kapatabilsin')}
            desc={t('Çalıştırma penceresindeki “Kapat ve tekrar dene” bu makinede dosyayı açık tutan programı kapatır. Kapalıyken gönderen yalnızca hangi programın tuttuğunu görür.')}
            on={a.allowClose === true}
            onChange={(v) => setA({ ...a, allowClose: v || undefined })}
          />
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label={t('Uygulamadan önce komut')} help={t('Bu makinede çalışır; dosyaları açık tutan programı durdurmak için. Sıfırdan farklı kodla biterse paket uygulanmaz.')}>
              <div className="input-wrap">
                <Terminal size={14} />
                <input className="input mono" value={a.beforeApply ?? ''} onChange={(e) => setA({ ...a, beforeApply: e.target.value || undefined })} placeholder="taskkill /im app.exe /f" spellCheck={false} />
              </div>
            </Field>
            <Field label={t('Uyguladıktan sonra komut')} help={t('Paket uygulandıktan sonra (başarısız olsa da) çalışır; programı yeniden başlatmak için. Nasıl bittiği gönderenin çalıştırma penceresinde görünür.')}>
              <div className="input-wrap">
                <Terminal size={14} />
                <input className="input mono" value={a.afterApply ?? ''} onChange={(e) => setA({ ...a, afterApply: e.target.value || undefined })} placeholder='start "" "C:\\App\\app.exe"' spellCheck={false} />
              </div>
            </Field>
          </div>
          <ToggleRow
            title={t('Uyguladıktan sonraki komut başarısızsa gönderim hatalı sayılsın')}
            desc={t('Komut bir sağlık denetimi gibi çalışır: sıfırdan farklı kodla biterse gönderen bu makineyi hatalı görür, aşamalı gönderim durur, “Hata olursa makineyi geri al” açıksa makine geri alınır.')}
            on={a.afterApplyFails === true}
            onChange={(v) => setA({ ...a, afterApplyFails: v || undefined })}
          />
        </>
      )}
    </Section>
  );
}
