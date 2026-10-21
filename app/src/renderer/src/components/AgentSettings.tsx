// Settings › Agent: this machine receives what other SamSync instances send it as one compressed pack and applies
// it to its own disk, with commands of its own before and after (stop and start the program that holds the files).
import { useState } from 'react';
import { Radio, Terminal } from 'lucide-react';
import type { AgentSettings } from '@shared/types';
import { useApp } from '../store/app';
import { Button, Field, ToggleRow } from './ui';
import { t } from '@shared/i18n';

const DEFAULTS: AgentSettings = { receivePacks: true, notifyOnApply: true };

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
          <ToggleRow title={t('Paket uygulanınca bildir')} desc={t('Bu makinede masaüstü bildirimi: kim gönderdi, kaç dosya')} on={a.notifyOnApply} onChange={(v) => setA({ ...a, notifyOnApply: v })} />
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label={t('Uygulamadan önce komut')} help={t('Bu makinede çalışır; dosyaları açık tutan programı durdurmak için. Sıfırdan farklı kodla biterse paket uygulanmaz.')}>
              <div className="input-wrap">
                <Terminal size={14} />
                <input className="input mono" value={a.beforeApply ?? ''} onChange={(e) => setA({ ...a, beforeApply: e.target.value || undefined })} placeholder="taskkill /im app.exe /f" spellCheck={false} />
              </div>
            </Field>
            <Field label={t('Uyguladıktan sonra komut')} help={t('Paket uygulandıktan sonra (başarısız olsa da) çalışır; programı yeniden başlatmak için.')}>
              <div className="input-wrap">
                <Terminal size={14} />
                <input className="input mono" value={a.afterApply ?? ''} onChange={(e) => setA({ ...a, afterApply: e.target.value || undefined })} placeholder='start "" "C:\\App\\app.exe"' spellCheck={false} />
              </div>
            </Field>
          </div>
        </>
      )}
    </Section>
  );
}
