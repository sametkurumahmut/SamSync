// Automation: settings, Git-triggered watches, plain folder destinations, live sync.
import type { Dict } from '../types';
import { pl } from '../types';

const d: Dict = {
  '{name}: Git değişiklikleri okunamadı': '{name}: could not read the Git changes',
  '{name}: {events} → {n} dosya': pl('{name}: {events} → {n} file', '{name}: {events} → {n} files'),
  '{n} değişiklik birden geldi; sınır {max}, gönderilmedi': pl('{n} change came at once; the limit is {max}, not sent', '{n} changes came at once; the limit is {max}, not sent'),
  'Senkron işi bulunamadı: {id}': 'Sync job not found: {id}',
  '{name}: senkron başarısız': '{name}: sync failed',
  '{path} bir Git deposunda değil.': '{path} is not in a Git repository.',
  'Dosya kaydedildiğinde ya da Git’te commit veya pull olduğunda birkaç saniye bekler, sonra yalnızca değişenleri seçili makinelere ya da klasörlere gönderir; istenirse bir senkron işini çalıştırır.':
    'When a file is saved, or after a commit or pull in Git, it waits a few seconds and sends only what changed to the selected machines or folders; it can also run a sync job instead.',
  '{n} hedef erişilemedi; değişiklikler {m} dakikada bir yeniden denenecek.': pl(
    '{n} target could not be reached; the changes will be retried every {m} minutes.',
    '{n} targets could not be reached; the changes will be retried every {m} minutes.',
  ),
  'Son gönderimde erişilemedi: {names}. Yeniden deneme kapalı, bu değişiklikleri almadılar.': 'Unreachable in the last send: {names}. Retrying is off, so they did not get these changes.',
  'Dosya kaydedilince': 'When a file is saved',
  'Git’te commit ya da pull olunca': 'After a commit or pull in Git',
  'HEAD bu yollardan biriyle ilerleyince o commit’lerin değiştirdiği dosyalar gönderilir (diskteki hâlleriyle). Dal değiştirmek varsayılan olarak bir şey göndermez. Aşağıya deponun klasörünü (ya da içindeki bir alt klasörü) ekleyin.':
    'When HEAD moves in one of these ways, the files those commits changed are sent (as they are on disk). Switching branches sends nothing by default. Add the repository folder (or a folder inside it) below.',
  'Git deposu': 'Git repository',
  'Ne yapılsın': 'What to do',
  'Makinelere ya da klasörlere gönder': 'Send to machines or folders',
  'Senkron işini çalıştır': 'Run a sync job',
  'Canlı senkron: değişince işin bütün çiftleri işin kipiyle eşitlenir': 'Live sync: on a change, every pair of the job is synced in the job’s mode',
  'Senkron işi': 'Sync job',
  'İzlenen yolda bir değişiklik olunca bu iş, kendi kipiyle (iki yönlü, ayna, güncelle…) çalışır.': 'When something changes in the watched path, this job runs in its own mode (two-way, mirror, update…).',
  Makineler: 'Machines',
  'Klasörler (yapılandırma gerekmez)': 'Folders (no configuration needed)',
  'Yerel, bağlı ya da ağ (\\\\sunucu\\paylaşım) klasörü. İzlenen her klasörün içeriği buraya, kendi içindeki yoluyla yazılır.':
    'A local, mounted or network (\\\\server\\share) folder. The content of each watched folder is written here with its paths inside that folder.',
  'Hedef klasör yolunu yapıştırıp Enter’a basın': 'Paste a target folder path and press Enter',
  'Başlarken mevcut farkları da gönder': 'Also send the existing differences at start',
  'İzleme açılınca, hedefte eksik ya da farklı olanlar önce bir kez gönderilir': 'When the watch starts, whatever is missing or different on the targets is sent once first',
  Commit: 'Commit',
  'Commit düzeltme (amend)': 'Commit amend',
  Merge: 'Merge',
  Pull: 'Pull',
  Rebase: 'Rebase',
  'Cherry-pick, revert': 'Cherry-pick, revert',
  Reset: 'Reset',
  'Dal değiştirme (checkout)': 'Branch switch (checkout)',
  'Otomasyon ayarları': 'Automation settings',
  'Bu bilgisayardaki bütün izlemeler ve zamanlanmış işler için geçerlidir.': 'Applies to every watch and scheduled job on this computer.',
  'Erişilemeyen makinelere yeniden dene': 'Retry unreachable machines',
  'Kapalıyken erişilemeyen makine o değişiklikleri almaz; açıkken değişiklikler saklanır ve makine erişilebilir olunca gönderilir':
    'When off, an unreachable machine misses those changes; when on, they are kept and sent once the machine can be reached',
  'Yeniden deneme aralığı (dk)': 'Retry interval (min)',
  Hiç: 'Never',
  'Yalnızca hatalarda': 'Only on errors',
  'Her gönderimde': 'Every send',
  'Tek seferde en çok dosya': 'Most files at once',
  'Fazlası birden değişirse (ör. dal değişince) gönderilmez; 0 = sınırsız': 'If more change at once (e.g. a branch switch) nothing is sent; 0 = no limit',
  'Kaçırılan zamanlamaları açılışta çalıştır': 'Run missed schedules at start',
  'Uygulama kapalıyken saati geçen senkron işi, uygulama açılınca çalışır': 'A sync job whose time passed while the app was closed runs when the app opens',
};

export default d;
