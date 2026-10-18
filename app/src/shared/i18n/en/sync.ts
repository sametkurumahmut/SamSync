// Folder sync: ignore files, --sync without a window, job files, the Recycle Bin and versions by age.
import type { Dict } from '../types';
import { pl } from '../types';

const d: Dict = {
  // ignore files
  '{path} okunamadı: {error}': 'Could not read {path}: {error}',

  // Recycle Bin and versioning
  'Geri dönüşüm kutusu kullanılamadı ({error}); eski hâller yedek klasörüne taşınacak.': 'The Recycle Bin could not be used ({error}); old versions go to the backup folder instead.',
  '{n} eski hâl geri dönüşüm kutusuna taşındı': pl('{n} old version moved to the Recycle Bin', '{n} old versions moved to the Recycle Bin'),
  'Eski yedekler temizlenemedi: {error}': 'Could not clean up the old backups: {error}',
  'Geri dönüşüm kutusu': 'Recycle Bin',
  'Bu makinedeki klasörlerde eski hâller geri dönüşüm kutusuna gider;\nağ yollarında ve hedef makinelerde yedek klasörüne taşınır':
    'In folders of this computer old versions go to the Recycle Bin;\non network paths and target machines they go to the backup folder',
  'Saklama süresi (gün)': 'Keep for (days)',
  'Bundan eski sürümler başarılı bir çalışmadan sonra silinir.\nBoş ya da 0: yaş sınırı yok': 'Older versions are removed after a successful run.\nEmpty or 0: no age limit',
  'Silinen ve üzerine yazılan dosyalar bu makinedeki klasörlerde geri dönüşüm kutusuna, öbür taraflarda {folder} klasörüne taşınır.':
    'Deleted and overwritten files go to the Recycle Bin in folders of this computer, and into the {folder} folder on the other sides.',

  // job files
  'Bu dosya bir SamSync senkron işi değil.': 'This file is not a SamSync sync job.',
  'Senkron işinin klasör çiftleri eksik ya da bozuk.': 'The folder pairs of the sync job are missing or broken.',
  'İçe aktarılan iş': 'Imported job',
  '{name} dışa aktarıldı: {path}': '{name} exported: {path}',
  '{name} içe aktarıldı: {path}': '{name} imported: {path}',
  'SamSync senkron işi': 'SamSync sync job',
  'İçe aktarılacak senkron işi': 'Sync job to import',
  'Senkron işi içe aktarıldı': 'Sync job imported',
  'İçe aktar…': 'Import…',
  'Senkron işini dışa aktar': 'Export the sync job',
  'Senkron işi dışa aktarıldı': 'Sync job exported',
  'Dışa aktarılamadı': 'Could not export',
  'İşi başka bir yapılandırmaya taşımak için dosyaya yazar': 'Writes the job to a file, to bring it into another configuration',

  // --sync
  '“{name}” adında {n} iş var; kimliğiyle verin: {ids}': '{n} jobs are named “{name}”; give the id instead: {ids}',
  'Senkron işi verilmedi. Örnek: SamSync.exe --sync "Gece yedeği"': 'No sync job given. Example: SamSync.exe --sync "Nightly backup"',
  'Komut satırı: {name}': 'Command line: {name}',
  'Senkron işi: {name} ({id})': 'Sync job: {name} ({id})',
  'Çakışma: {n} (dokunulmadı)': 'Conflicts: {n} (left alone)',
  'Hata: {n}': 'Errors: {n}',
  '… ve {n} hata daha': pl('… and {n} more error', '… and {n} more errors'),
  'Senkron {name}: işlem {ops}, hata {errors}': 'Sync {name}: operations {ops}, errors {errors}',
  'İki sürüm de saklanmıştı; bir taraf değişene dek dokunulmaz': 'Both versions were kept; nothing happens until one side changes',
  'İkisini de sakla': 'Keep both',
  'Çakışmaları tek tek ya da toplu çözün: sol, sağ, ikisini de sakla': 'Resolve the conflicts one by one or all at once: left, right, keep both',
  '{n} çakışmayı çöz…': 'Resolve {n} conflicts…',
  'Çakışmaları çöz': 'Resolve conflicts',
  '{done}/{n} karar verildi; karar verilmeyenlere dokunulmaz.': '{done}/{n} decided; the undecided ones are left alone.',
  'Hepsine:': 'For all:',
  'Tarihi daha yeni olan taraf kazanır; tarihleri aynı olanlara dokunulmaz': 'The side with the newer date wins; equal dates are left alone',
  'Yeni olan kazansın': 'Newer wins',
  'Sol kazansın': 'Left wins',
  'Sağ kazansın': 'Right wins',
  'Her iki tarafa öbürünün sürümü "ad (sol).uzantı" / "ad (sağ).uzantı" olarak yazılır; hiçbir şey silinmez': 'Each side gets the other\'s version as "name (left).ext" / "name (right).ext"; nothing is deleted',
  'Hepsini atla': 'Skip all',
  'daha yeni': 'newer',
};

export default d;
