// i18n-ignore-file: bilingual content by design (both languages written out), not UI strings for t()
// What the help bot and the Help page know by heart: questions people ask about SamSync, with the answer in
// both languages and, where it helps, the page to open. The README (bundled as text) is searched too; the
// entries here are the short, direct answers. Keep the ids stable: the bot's "was this helpful" counts use them.
import type { AppPage as Page } from '../pages';

export interface FaqEntry {
  id: string;
  /** Topic group (shown as a heading on the Help page). */
  topic: FaqTopic;
  q: { tr: string; en: string };
  a: { tr: string; en: string };
  /** Extra words people use for this question, for the search (both languages mixed). */
  keywords?: string[];
  /** Where to go for it. */
  page?: Page;
}

export type FaqTopic = 'start' | 'send' | 'review' | 'relay' | 'pack' | 'automation' | 'compare' | 'backup' | 'targets' | 'settings' | 'trouble';

export const FAQ_TOPICS: { id: FaqTopic; tr: string; en: string }[] = [
  { id: 'start', tr: 'Başlarken', en: 'Getting started' },
  { id: 'send', tr: 'Gönderim', en: 'Sending' },
  { id: 'review', tr: 'İnceleme ve karşılaştırma', en: 'Review and comparison' },
  { id: 'relay', tr: 'Röle ve hız', en: 'Relay and speed' },
  { id: 'pack', tr: 'Paket ve diskle sürüm', en: 'Packs and releases on a disk' },
  { id: 'automation', tr: 'Otomasyon', en: 'Automation' },
  { id: 'compare', tr: 'Git ve senkron', en: 'Git and sync' },
  { id: 'backup', tr: 'Yedek ve geri alma', en: 'Backups and undo' },
  { id: 'targets', tr: 'Makineler', en: 'Machines' },
  { id: 'settings', tr: 'Ayarlar ve kısayollar', en: 'Settings and shortcuts' },
  { id: 'trouble', tr: 'Sorun giderme', en: 'Troubleshooting' },
];

export const FAQ: FaqEntry[] = [
  // ---- start
  {
    id: 'what-is',
    topic: 'start',
    q: { tr: 'SamSync ne işe yarar?', en: 'What is SamSync for?' },
    a: {
      tr: 'Dosyaları, klasörleri ve Git değişikliklerini birden çok makineye **aynı göreli yolla** gönderir: kaynak `D:\\Release\\Data\\settings.json` ise her hedefte `<kök>\\Data\\settings.json` yazılır. Göndermeden önce ne olacağını dosya dosya gösterir, yedek alır, doğrular; hedefleri karşılaştırır, klasörleri eşitler, değişince ya da zamanı gelince kendi gönderir.',
      en: 'It sends files, folders and Git changes to several machines **under the same relative path**: a source `D:\\Release\\Data\\settings.json` lands on every target as `<root>\\Data\\settings.json`. It shows what will happen file by file before sending, keeps backups, verifies; it compares targets, syncs folders and sends by itself on changes or on a schedule.',
    },
    keywords: ['nedir', 'ne yapar', 'amaç', 'what does it do', 'overview'],
    page: 'overview',
  },
  {
    id: 'first-send',
    topic: 'start',
    q: { tr: 'İlk gönderimi nasıl yaparım?', en: 'How do I make my first send?' },
    a: {
      tr: '1) **Gönder** sayfasına dosya veya klasörleri sürükleyin (ya da *Dosya ekle*). 2) Sağdaki listeden hedef makineleri seçin (grup başlığı bütün grubu seçer). 3) **İncele ve gönder**: plan her hedefte ne olacağını gösterir; istemediğiniz satırların işaretini kaldırın. 4) **Gönder**. Çalıştırma paneli ilerlemeyi, hızı ve kalan süreyi gösterir; sonuç Geçmiş sayfasına yazılır.',
      en: '1) Drag files or folders onto the **Send** page (or *Add files*). 2) Pick the target machines in the list on the right (a group heading picks the whole group). 3) **Review and send**: the plan shows what will happen on each target; untick what you do not want. 4) **Send**. The run panel shows progress, pace and time left; the result goes to the History page.',
    },
    keywords: ['nasıl gönderirim', 'başla', 'how to send', 'start'],
    page: 'send',
  },
  {
    id: 'relative-path',
    topic: 'start',
    q: { tr: 'Dosya hedefte nereye yazılır? Göreli yol nedir?', en: 'Where does a file land on the target? What is the relative path?' },
    a: {
      tr: 'Her makinenin **yerel kökleri** vardır (Hedefler › makine kartı). Kaynak bu köklerden birinin altındaysa kökten sonrası göreli yoldur ve hedefte de hedefin kökünün altına aynı yolla yazılır. Kaynak hiçbir kökün altında değilse "kök dışı" rozeti çıkar ve kendi klasörü hedef kökünün yerine geçer: klasörün içindekiler doğrudan hedef köküne, dosya da adıyla oraya gider. Gönder sayfasında kaynağın altındaki listeden üstteki bir klasörü kök yapabilir ya da sürücü harfiyle tam yolu (`C/Projeler/x.txt` gibi) seçebilirsiniz. **Yerel kök yap** klasörü bu makinenin yerel köklerine ekler. Ayarlar › Kopyalama › *Kök dışı kaynakları tam yoluyla gönder* eski davranışı varsayılan yapar.',
      en: 'Every machine has **local roots** (Targets › machine card). When the source is below one of them, what follows the root is the relative path, and the target gets it below its own root. A source outside every root shows an "outside roots" badge, and its own folder stands for the target root: a folder\'s content goes straight into the target root, a file goes there by its name. On the Send page the list under the source makes a folder above it the root instead, or keeps the full path with the drive letter (`C/Projects/x.txt`). **Make local root** adds the folder to this machine\'s local roots. Settings › Copy › *Send sources outside the roots with their full path* makes the old way the default.',
    },
    keywords: ['yerel kök', 'local root', 'kök dışı', 'outside roots', 'hedef kökü', 'target root', 'tam yol', 'full path', 'path'],
    page: 'targets',
  },
  {
    id: 'this-machine',
    topic: 'start',
    q: { tr: 'Uygulama hangi makinede olduğunu nasıl biliyor?', en: 'How does the app know which machine it runs on?' },
    a: {
      tr: 'Yapılandırma bütün makinelerde ortak. Uygulama bilgisayar adını ve IP adreslerini makine listesiyle karşılaştırıp kendini tanır (başlık çubuğundaki yeşil nokta). Tanıyamazsa Hedefler › **Bu makine** kartından elle seçin ya da `SAMSYNC_NODE_ID` ortam değişkenini tanımlayın. Kendisi yalnızca kaynakların hepsi paketse ya da yerel köklerinin dışındaysa (başka bir diskteki sürüm gibi) hedef olabilir; o zaman dosyalar doğrudan ilk yerel köküne yazılır.',
      en: 'The configuration is shared by every machine. The app matches the computer name and IP addresses against the machine list to recognise itself (the green dot in the title bar). If it cannot, pick it by hand under Targets › **This machine** or set the `SAMSYNC_NODE_ID` environment variable. It can be a target itself only when every source is a pack or lies outside its local roots (a release on another disk); the files then go straight to its first local root.',
    },
    keywords: ['tanımsız makine', 'unknown machine', 'kimlik', 'identity', 'hostname'],
    page: 'targets',
  },
  // ---- send
  {
    id: 'overlapping-sources',
    topic: 'send',
    q: { tr: 'İki kaynak hedefte aynı yere ya da iç içe giderse ne olur?', en: 'What happens when two sources go to the same place, or one inside the other, on the targets?' },
    a: {
      tr: 'Aynı yere giden iki klasörün içerikleri birleştirilir; ikisinde de olan dosya listede önce gelenden alınır ve inceleme bunu bir uyarıyla söyler. Başka bir kaynağın yerinin içine düşen kaynak o kısmı devralır: `Release` köke, `D:\\icerik\\Contents` de `Contents`\'e giderse hedeflerdeki `Contents` yalnızca ikinciden gelir; `Release` orada ne karşılaştırır, ne yazar, ne siler. Her kaynağın gideceği yer Gönder sayfasında satırın altındaki listeden seçilir ya da **Başka bir yol yaz…** ile elle yazılır.',
      en: 'Two folders for the same place are merged; a file both hold comes from the one listed first, and the review warns about it. A source that lands inside another one\'s place takes that part over: with `Release` going to the root and `D:\\content\\Contents` going to `Contents`, the targets\' `Contents` comes only from the second, and `Release` neither compares, writes nor deletes there. Where each source goes is picked on the Send page from the list under it, or typed with **Type another path…**.',
    },
    keywords: ['çakışma', 'overlap', 'birleştir', 'merge', 'contents', 'hedef yolu', 'target path', 'aynı yer', 'same place'],
    page: 'send',
  },
  {
    id: 'source-list',
    topic: 'send',
    q: { tr: 'Bir kaynağı listeden çıkarmadan nasıl kapatırım, birden çok kaynağı nasıl seçerim?', en: 'How do I turn a source off without removing it, or pick several sources?' },
    a: {
      tr: 'Kaynağın önündeki onay kutusu onu kapatır: listede kalır ama gönderilmez, karşılaştırılmaz, pakete yazılmaz. Tıklamak bir kaynağı seçer, Ctrl bir tane ekler, Shift aralık alır, Ctrl+A hepsini seçer; üstteki çubuk seçilenleri etkinleştirir, devre dışı bırakır ya da çıkarır. Sağ tık **Explorer’da göster** ve **Yolu kopyala** da sunar.',
      en: 'The checkbox in front of a source turns it off: it stays in the list but is not sent, compared or packed. A click picks a source, Ctrl adds one, Shift a range, Ctrl+A all; the bar above turns the picked ones on or off or removes them. A right click also offers **Show in Explorer** and **Copy path**.',
    },
    keywords: ['devre dışı', 'turn off', 'seç', 'select', 'çoklu', 'multiple', 'sağ tık', 'right click', 'explorer'],
    page: 'send',
  },
  {
    id: 'modes',
    topic: 'send',
    q: { tr: 'Üzerine yaz, Yalnızca yeni ve Ayna kipleri arasındaki fark ne?', en: 'What is the difference between overwrite, update-only and mirror?' },
    a: {
      tr: '**Üzerine yaz:** yeni ve değişen her dosya yazılır; hedefte daha yeni olanlar da (uyarıyla) güncellenir. **Yalnızca yeni:** hedefte daha yeni ya da aynı yaştaki dosyalara dokunulmaz. **Ayna:** klasörler birebir eşitlenir; hedefte olup kaynakta olmayan dosyalar silinir (inceleme kaç dosyanın silineceğini söyler, gönderim öncesi bir kez daha sorar). Kip gönderim seçeneklerinde ve makine başına ayrı ayarlanabilir.',
      en: '**Overwrite:** every new and changed file is written; files newer on the target are updated too (with a warning). **Update only:** files that are newer or as old on the target are left alone. **Mirror:** folders are made identical; files on the target that are not in the source are deleted (the review says how many, and asks once more before sending). The mode is set in the send options, and per machine.',
    },
    keywords: ['mode', 'mirror', 'overwrite', 'update', 'silme', 'delete'],
    page: 'send',
  },
  {
    id: 'compare-method',
    topic: 'send',
    q: { tr: 'Tarih + boyut, içerik ve boyut karşılaştırması ne demek?', en: 'What do the date+size, content and size comparisons mean?' },
    a: {
      tr: '**Tarih + boyut** (varsayılan, hızlı): değiştirilme zamanı ve boyut aynıysa dosya aynı sayılır (2 sn tolerans, yaz saati kayması yok sayılabilir). **İçerik:** aynı boyuttaki dosyalar bayt bayt karşılaştırılır — kesin ama ağ üzerinden okuma gerektirir; özetler `hashcache.json`da hatırlanır, ikinci sefer daha hızlıdır. **Boyut:** yalnızca boyuta bakar.',
      en: '**Date + size** (default, fast): same modification time and size means the same file (2 s tolerance, a DST shift can be ignored). **Content:** files of the same size are compared byte by byte — exact, but reads over the network; hashes are remembered in `hashcache.json`, so the second time is faster. **Size:** looks at the size only.',
    },
    keywords: ['karşılaştırma yöntemi', 'compare', 'hash', 'content'],
    page: 'send',
  },
  {
    id: 'per-target',
    topic: 'send',
    q: { tr: 'Bir makineye farklı kip ya da yedek ayarı verebilir miyim?', en: 'Can one machine have its own mode or backup setting?' },
    a: {
      tr: 'Evet. Hedef listesinde makine satırının sonundaki ayar düğmesi o makineye kendi kipini ve yedeğini verir ((sunucu yedekli ayna, öteki makineler yalnızca yeni gibi)). Satırda rozet çıkar, alt çubuk sayar, inceleme hedef kartında gösterir. *Seç › Hedefe özel ayarları temizle* hepsini genel seçeneklere döndürür.',
      en: 'Yes. The slider button at the end of a machine row in the target list gives that machine its own mode and backup ((the server mirrors with a backup, the other machines take newer files only, say)). The row shows a badge, the bottom bar counts them, the review shows them on the target card. *Select › Clear per-target settings* brings every machine back to the general options.',
    },
    keywords: ['hedefe özel', 'per target', 'istisna', 'exception'],
    page: 'send',
  },
  {
    id: 'quick-send',
    topic: 'send',
    q: { tr: 'Aynı gönderimi her seferinde yeniden kurmadan tek tıkla nasıl yaparım?', en: 'How do I repeat the same send with one click?' },
    a: {
      tr: '**Hızlı gönderim** kaydedin: Gönder sayfasında listeyi (kaynaklar, hedefler, seçenekler) hazırlayıp *Bu listeyi kaydet*. Sonra şeritteki çipten, tepsi menüsünden, komut paletinden, `SamSync.exe --quick "ad"` ile ya da sistem geneli bir kısayol tuşuyla (örn. Ctrl+Alt+1) çalışır. "Önce incele" açıksa inceleme açılır. Çipteki kalemle ad, kısayol ve **zamanlama** düzenlenir.',
      en: 'Save a **quick send**: put the list together on the Send page (sources, targets, options) and *Save this list*. Then it runs from the chip on the strip, the tray menu, the command palette, `SamSync.exe --quick "name"` or a system-wide key (e.g. Ctrl+Alt+1). With "Review first" on, the review opens. The pencil on the chip edits the name, the key and the **schedule**.',
    },
    keywords: ['hızlı gönderim', 'quick send', 'kısayol', 'hotkey', 'tray'],
    page: 'send',
  },
  {
    id: 'explorer-menu',
    topic: 'send',
    q: { tr: 'Explorer sağ tık menüsünden nasıl gönderirim?', en: 'How do I send from the Explorer right-click menu?' },
    a: {
      tr: 'Kurulu sürümde menü kendiliğinden gelir (Ayarlar › Sağ tık menüleri). Bir dosya ya da klasöre sağ tıklayın › **SamSync** › *İncele ve gönder*, *Son ayarla gönder*, profil ya da grup adı. Menü küçük `SamSyncSend.exe` programını başlatır; o da komutu çalışan uygulamaya birkaç milisaniyede verir. Notepad++ sekme menüsü ve `Ctrl+Alt+W` de var.',
      en: 'The installed app adds the menu by itself (Settings › Right-click menus). Right-click a file or folder › **SamSync** › *Review and send*, *Send with the last settings*, a profile or a group. The menu starts the small `SamSyncSend.exe`, which hands the command to the running app in a few milliseconds. There is a Notepad++ tab menu and `Ctrl+Alt+W` too.',
    },
    keywords: ['sağ tık', 'context menu', 'notepad++', 'menü'],
    page: 'settings',
  },
  {
    id: 'speed-expectation',
    topic: 'relay',
    q: { tr: 'Gönderim neden yavaş? Ne kadar sürer?', en: 'Why is the send slow? How long does it take?' },
    a: {
      tr: 'Hız çoğu zaman ağa bağlıdır: Wi‑Fi üzerinden uzak makinelere ~0,5 MB/sn ve dosya başına ~1 sn gecikme ölçüldü; kabloda aynı iş 50–100 kat hızlı. Küçük dosya çok olan bir sürümde dosya başına gecikme ağır basar. Çareler: **röle** (tek kopya gider, oradaki SamSync dağıtır; paket sıkıştırılır), **manifest** (plan hedefi ağdan gezmez), kabloya geçmek, Hedefler kartındaki **hız sınaması** ile bağlantıyı ölçmek. Çalıştırma panelindeki grafik anlık hızı gösterir.',
      en: 'The network usually sets the pace: over Wi‑Fi to remote machines about 0.5 MB/s and about 1 s per file were measured; on a cable the same job is 50–100× faster. In a release of many small files the per-file latency dominates. Remedies: the **relay** (one copy goes, SamSync there distributes; the pack is compressed), the **manifest** (the plan does not walk the target over the network), a cable, and the **speed test** on the machine card. The chart in the run panel shows the current pace.',
    },
    keywords: ['yavaş', 'slow', 'hız', 'süre', 'wifi', 'performance'],
    page: 'targets',
  },
  // ---- review
  {
    id: 'review-signs',
    topic: 'review',
    q: { tr: 'İncelemedeki + ~ ! − işaretleri ne anlama geliyor?', en: 'What do the + ~ ! − signs in the review mean?' },
    a: {
      tr: '`+` hedefte yok, yeni yazılacak. `~` değişmiş, güncellenecek. `!` hedefteki dosya **daha yeni** (Üzerine yaz kipinde yazılır, Yalnızca yeni kipinde atlanır). `−` hedefte fazla (yalnızca Ayna kipinde silinir) ya da Git\'te silinmiş. Klasör satırları dalın toplamlarını taşır; onay kutusu bütün dalı seçer ya da bırakır. `⇄` kaynak–hedef satır farkını açar.',
      en: '`+` not on the target, will be written. `~` changed, will be updated. `!` the file on the target is **newer** (written in overwrite mode, skipped in update-only). `−` extra on the target (deleted only in mirror mode) or deleted in Git. Folder rows carry their branch totals; the checkbox takes or drops the whole branch. `⇄` opens the source–target line diff.',
    },
    keywords: ['işaret', 'sign', 'plan', 'review', 'ağaç', 'tree'],
    page: 'send',
  },
  {
    id: 'manifest',
    topic: 'review',
    q: { tr: 'samsync-manifest.json nedir, silebilir miyim?', en: 'What is samsync-manifest.json, can I delete it?' },
    a: {
      tr: 'Her gönderimden sonra hedefin kökünde kalır: gönderilen klasörün altındaki her şeyin adı, boyutu, tarihi ve kim ne zaman yazdı. Sonraki plan 1.400 klasörü ağdan gezmek yerine ondan başlar; önce kökün listesini ve 24 dosyalık bir örneği hedefle doğrular, biri bile tutmazsa tam tarama yapar. 7 günden eski manifest kullanılmaz. Silerseniz bir sonraki gönderim yalnızca tam tarama yapar; zarar vermez. Envanter tablosu da bu dosyadan beslenir.',
      en: 'It stays at the target root after every send: name, size and time of everything below the sent folder, and who wrote it when. The next plan starts from it instead of walking 1,400 folders over the network; first the root listing and a sample of 24 files are checked against the target, one mismatch means a full walk. A manifest older than 7 days is ignored. Deleting it only costs the next send a full walk. The inventory table is fed from it too.',
    },
    keywords: ['manifest', 'manifestten', 'hızlı karşılaştırma'],
    page: 'targets',
  },
  {
    id: 'lock',
    topic: 'review',
    q: { tr: '"X yazıyor" uyarısı ne demek? samsync-lock.json nedir?', en: 'What does the "X is writing" warning mean? What is samsync-lock.json?' },
    a: {
      tr: 'Bir gönderim bir makineye yazarken kökte `samsync-lock.json` bırakır (bilgisayar adı, kullanıcı, gönderimin adı, başlangıç). Başkasının taze kilidi varsa inceleme o makinede "ahmet yazıyor" rozetiyle uyarır: aynı anda gönderirseniz dosyalar karışabilir. Gönderim yine devam eder; bitince kilit kaldırılır. 30 dakikadan eski kilit yok sayılır (çöken bir gönderimden kalmış olabilir).',
      en: 'While a run writes to a machine it leaves `samsync-lock.json` at the root (computer, user, label, start time). A fresh lock of someone else shows on that machine in the review as "ahmet is writing": sending at the same time could mix the files. The send still goes ahead; the lock is removed at the end. A lock older than 30 minutes is ignored (a crashed run may have left it).',
    },
    keywords: ['kilit', 'lock', 'yazıyor', 'aynı anda'],
    page: 'send',
  },
  {
    id: 'compare-page',
    topic: 'review',
    q: { tr: 'Göndermeden hedefle farkları nasıl görürüm?', en: 'How do I see the differences without sending?' },
    a: {
      tr: '**Karşılaştır** sayfası: Gönder sayfasındaki kaynakları seçili hedeflerle karşılaştırır, hiçbir şey yazmaz. Her hedefin sekmesinde yeni / değişen / hedefte daha yeni / fazla dosyalar, süzgeç ve arama; dosyaya tıklayınca satır farkı. *Bu farkları gönder…* incelemeyi açar. **Makine ↔ makine** kipi ise aynı klasörü iki makinede karşılaştırır (A ↔ B sapması).',
      en: 'The **Compare** page: it compares the Send page\'s sources with the chosen targets and writes nothing. Each target\'s tab lists new / changed / newer-on-target / extra files with a filter and a search; a click shows the line diff. *Send these differences…* opens the review. The **Machine ↔ machine** mode compares the same folder on two machines (A ↔ B drift).',
    },
    keywords: ['karşılaştır', 'compare', 'fark', 'diff', 'iki makine'],
    page: 'compare',
  },
  // ---- relay
  {
    id: 'relay-what',
    topic: 'relay',
    q: { tr: 'Röle nedir, ne zaman kullanılır?', en: 'What is a relay and when is it used?' },
    a: {
      tr: 'Bir gruptaki bir makine (genelde grubun hep açık duran ana makinesi) kartında **röle** olarak işaretlenir. Röleyle birlikte grubun öbür makinelerini de içeren bir gönderim yalnızca röleye yazar — kendi yavaş bağlantınızdan tek kopya, sıkıştırılmış paket olarak. Oradaki SamSync paketi diskine uygular, sonra grubun kendi (hızlı) ağından ötekilere dağıtır ve sonucu bildirir. Wi‑Fi\'dan 5 makineye 7 GB: doğrudan ~20 saat, röleyle ~2 saat. Kabloda fark azdır. Röle için o makinede SamSync\'in çalışıyor olması gerekir ("röle açık" rozeti).',
      en: 'A machine of a group (usually the group\'s always-on main machine) is marked **relay** on its card. A send that includes the relay and other machines of its group writes to the relay only — one compressed pack over your own slow link. SamSync there applies the pack to its disk, then distributes over the group\'s own (fast) network and reports back. 7 GB to 5 machines over Wi‑Fi: ~20 h directly, ~2 h through the relay. On a cable the difference is small. SamSync must be running on the relay ("relay on" badge).',
    },
    keywords: ['röle', 'relay', 'dağıtım', 'sunucu', 'server', 'paket'],
    page: 'targets',
  },
  {
    id: 'relay-down',
    topic: 'relay',
    q: { tr: '"Röle kapalı" diyor, ne olur?', en: 'It says "relay off", what happens?' },
    a: {
      tr: 'Röledeki SamSync yarım dakikada bir `_SamSyncRelay\\alive.json` yazar; 90 saniyedir yazmamışsa kapalı sayılır. O zaman plan röleye ve arkasındakilere **doğrudan** yazar, beklemez (inceleme bunu söyler). Röle açık görünüp işi 60 sn içinde almazsa paket geri alınır ve o makinelere buradan doğrudan ayrı bir gönderim başlar. Çözüm: röle makinesinde SamSync\'i açın (tepside kalması yeter).',
      en: 'SamSync on the relay writes `_SamSyncRelay\\alive.json` every half minute; silent for 90 s means off. Then the plan writes to the relay and the machines behind it **directly**, without waiting (the review says so). If a relay that looks on does not pick the job up within 60 s, the pack is taken back and a separate direct send to those machines starts from here. Fix: start SamSync on the relay machine (sitting in the tray is enough).',
    },
    keywords: ['röle kapalı', 'relay off', 'heartbeat', 'alive'],
    page: 'targets',
  },
  // ---- pack
  {
    id: 'pack-write',
    topic: 'pack',
    q: { tr: 'Sürümü USB diskle götüreceğim; SamSync bunu destekliyor mu?', en: 'I will carry the release on a USB disk; does SamSync support that?' },
    a: {
      tr: 'Evet: Gönder sayfasında kaynakları seçip **Paket yaz** deyin; kaynaklar (dışlamalar ve `.samsyncignore` uygulanmış) tek bir sıkıştırılmış `.samsync-pack` dosyasına yazılır. Diski hedef makineye takın, oradaki SamSync\'te dosyayı Gönder listesine ekleyin (sürükleyin), hedef olarak **bu makine**\'yi seçin, *İncele ve gönder*. Yalnızca farklı olanlar yazılır, ayna fazlalıkları siler, manifest kalır; sonraki ağ gönderimi hızlıdır. Aynı paket başka makinelere de hedef seçilerek uygulanabilir.',
      en: 'Yes: pick the sources on the Send page and press **Write pack**; the sources (exclusions and `.samsyncignore` applied) go into one compressed `.samsync-pack` file. Plug the disk into the target machine, add the file to the Send list in SamSync there (drag it), pick **this machine** as the target, *Review and send*. Only what differs is written, mirror deletes extras, the manifest stays; the next network send is fast. The same pack can target other machines too.',
    },
    keywords: ['paket', 'pack', 'usb', 'disk', 'çevrimdışı', 'offline'],
    page: 'send',
  },
  {
    id: 'pack-manifest',
    topic: 'pack',
    q: { tr: 'Sürümü elle diskten kopyaladım; sonra ne olur?', en: 'I copied the release from a disk by hand; what happens next?' },
    a: {
      tr: 'Elle kopyalama manifesti geçersiz kılar (örnek dosyaların tarihleri tutmaz): sonraki gönderimde plan o klasörü tam tarar ve yeni bir manifest yazar; ondan sonrakiler yine hızlıdır. Emin olmak için Karşılaştır sayfası her zaman doğrudan bakar. Elle kopyalamak yerine **Paket yaz / uygula** kullanırsanız tarama olmaz ve envanter de doğru kalır.',
      en: 'A copy by hand invalidates the manifest (the sample files\' times no longer match): the next send walks that folder fully and writes a new manifest; the ones after it are fast again. The Compare page always looks for itself. Using **Write pack / apply** instead of a hand copy avoids the walk and keeps the inventory right.',
    },
    keywords: ['elle kopyalama', 'copied by hand', 'manifest geçersiz'],
    page: 'targets',
  },
  // ---- automation
  {
    id: 'watch',
    topic: 'automation',
    q: { tr: 'Bir klasör değişince kendiliğinden gönderilsin istiyorum', en: 'I want a folder to be sent by itself when it changes' },
    a: {
      tr: 'Gönder sayfasında kaynakları ve hedefleri seçip **İzle** deyin (ya da Otomasyon sayfasından ekleyin). İzleme, değişiklikten sonra kısa bir sessizlik bekler (varsayılan 2 sn) ve yalnızca değişenleri gönderir. Git olaylarında (commit, merge, pull) de tetiklenebilir; düz klasörlere de gönderebilir ya da bir senkron işi çalıştırabilir. Kartındaki gönder düğmesi farkları beklemeden yollar. Uygulama tepside kalınca izleme sürer.',
      en: 'Pick sources and targets on the Send page and press **Watch** (or add one on the Automation page). The watch waits for a short quiet period after a change (2 s by default) and sends only what changed. It can trigger on Git events (commit, merge, pull), send to plain folders, or run a sync job. The send button on its card sends the differences right away. The watch keeps going while the app sits in the tray.',
    },
    keywords: ['izle', 'watch', 'otomatik', 'automatic', 'değişince'],
    page: 'automation',
  },
  {
    id: 'schedule',
    topic: 'automation',
    q: { tr: 'Her gece 02:00\'de sürümü göndermek istiyorum', en: 'I want the release sent every night at 02:00' },
    a: {
      tr: 'Bir **hızlı gönderim** kaydedin, çipteki kalemden **Zamanla**\'yı açın: belirli saatler (02:00) ya da her N dakikada bir. Zamanı gelince bu makinede inceleme açılmadan gönderilir; değişiklik yoksa bir şey yapılmaz. Otomasyon sayfasında zamanlanmış işler arasında listelenir (*Şimdi çalıştır* var). Uygulama açık ya da tepside olmalı; Ayarlar › Arka plan ile Windows açılışında tepside başlatabilirsiniz. Senkron işleri de aynı biçimde zamanlanır.',
      en: 'Save a **quick send** and open **Schedule** from the pencil on its chip: fixed times (02:00) or every N minutes. When the time comes it is sent from this machine without a review; nothing happens when nothing changed. It is listed with the scheduled jobs on the Automation page (*Run now*). The app must be open or in the tray; Settings › Background can start it in the tray with Windows. Sync jobs are scheduled the same way.',
    },
    keywords: ['zamanla', 'schedule', 'gece', 'saat', 'cron', 'zamanlanmış'],
    page: 'automation',
  },
  {
    id: 'notify',
    topic: 'automation',
    q: { tr: 'Gönderim bitince ekibe haber gitsin mi? Telegram olur mu?', en: 'Can the team be told when a send ends? Telegram?' },
    a: {
      tr: 'Ayarlar › **Bildirimler**: bir web kancası URL\'si (her bitişte JSON POST: durum, etiket, makineler, sayılar, özet metin) ve/veya Telegram bot anahtarı + sohbet kimliği. Hatalı ve kısmi bitişlerde her zaman, başarılılarda isteğe bağlı; başarısız makineler nedenleriyle listelenir. *Sına* düğmesi deneme mesajı yollar. Masaüstü bildirimi ayrıca gönderim seçeneklerindeki "Bitince bildir" ile gelir.',
      en: 'Settings › **Notifications**: a webhook URL (a JSON POST on every finish: status, label, machines, counts, a summary text) and/or a Telegram bot token + chat id. Always on failed and partial finishes, optionally on success; the failed machines are listed with why. *Test* sends a trial message. The desktop notification comes separately from "Notify when done" in the send options.',
    },
    keywords: ['bildirim', 'notification', 'webhook', 'telegram', 'teams', 'slack'],
    page: 'settings',
  },
  // ---- compare (git & sync)
  {
    id: 'git-send',
    topic: 'compare',
    q: { tr: 'Son commit\'imdeki dosyaları nasıl gönderirim?', en: 'How do I send the files of my last commit?' },
    a: {
      tr: '**Git** sayfası depoyu yerel köklerden bulur. Commit listesinde *Son commit* (ya da Ctrl/Shift ile birkaç commit) seçin; dosyalar tek listede birleşir, farkı sağda. İçerik **diskteki hâli** ya da **commit\'teki hâli** olabilir; silinen/taşınan dosyalar hedeften de kaldırılır (kapatılabilir). Commit içeriği hedefle git özeti üzerinden karşılaştırılır, aynı dosya yeniden yazılmaz. Komut paletinde *Son commit\'i gönder* de var.',
      en: 'The **Git** page finds the repository from the local roots. Pick *Last commit* (or several with Ctrl/Shift) in the commit list; their files merge into one list with the diff on the right. The content can be **as on disk** or **as in the commit**; deleted/moved files are removed from the targets too (can be turned off). Commit content is compared through the git hash, so identical files are not rewritten. The palette has *Send last commit* too.',
    },
    keywords: ['git', 'commit', 'yerel değişiklik', 'working tree'],
    page: 'git',
  },
  {
    id: 'sync-vs-send',
    topic: 'compare',
    q: { tr: 'Senkron ile Gönder arasındaki fark ne?', en: 'What is the difference between Sync and Send?' },
    a: {
      tr: '**Gönder** tek yönlüdür: buradaki kaynaklar hedeflere gider. **Senkron** klasör çiftleri içindir: iki yönlü (son durumu hatırlar, bir tarafta silinen öbüründe de silinir, iki tarafta değişen çakışma olur), ayna, güncelle ya da özel; filtreler, sürüm klasörü / geri dönüşüm kutusu, zamanlama, `--sync` ile pencere açmadan çalıştırma. İki makineyi birbirine eşitlemek Senkron işidir.',
      en: '**Send** is one way: the sources here go to the targets. **Sync** is for folder pairs: two-way (remembers the last state, a deletion on one side is a deletion on the other, a change on both is a conflict), mirror, update or custom; filters, versioning folder / recycle bin, a schedule, `--sync` to run without a window. Making two machines equal to each other is a Sync job.',
    },
    keywords: ['senkron', 'sync', 'iki yönlü', 'two-way', 'eşitle'],
    page: 'sync',
  },
  {
    id: 'ignore-file',
    topic: 'compare',
    q: { tr: 'Bazı dosyaları hep dışarıda bırakmak istiyorum', en: 'I want some files always left out' },
    a: {
      tr: 'Gönderilen klasörün köküne **`.samsyncignore`** koyun: satır başına bir desen (`*.tmp`, `Logs/`, `bin/*.pdb`), `#` açıklama. Her gönderimde ve senkronda uygulanır; dosyanın kendisi kopyalanmaz. Gönderim seçeneklerindeki *Filtreler* (hariç dosya/klasör kalıpları) ve Ayarlar › Kopyalama\'daki varsayılan dışlamalar da var. `log\\traces` gibi devasa klasörleri burada dışlamak gönderimi çok hızlandırır.',
      en: 'Put a **`.samsyncignore`** at the root of the sent folder: one pattern per line (`*.tmp`, `Logs/`, `bin/*.pdb`), `#` for comments. It applies to every send and sync; the file itself is never copied. The *Filters* in the send options (excluded file/folder patterns) and the default exclusions under Settings › Copy exist too. Excluding huge folders such as `log\\traces` here speeds a send up a lot.',
    },
    keywords: ['samsyncignore', 'hariç', 'exclude', 'filtre', 'ignore'],
    page: 'send',
  },
  // ---- backup
  {
    id: 'backup-restore',
    topic: 'backup',
    q: { tr: 'Yanlış dosya gönderdim, eski hâline nasıl dönerim?', en: 'I sent the wrong file; how do I get the old one back?' },
    a: {
      tr: '"Yedek al" açıksa eski hâller hedefte `_SamSyncYedek\\<tarih>\\` altında durur. **Yedekler** sayfasında öğeyi seçin, hangi makinelerde hangi tarihler var görün, *Geri al*; şimdiki hâl de önce yedeklenir. Bütün bir gönderimi geri almak için **Geçmiş** › o çalıştırma › **Geri al**: değiştirdiği ve sildiği dosyalar yedeklerden gelir, eklediği dosyalar silinir (yalnızca yedek alınmış gönderimlerde).',
      en: 'With "Keep a backup" on, the old versions sit on the target under `_SamSyncYedek\\<timestamp>\\`. On the **Backups** page pick the item, see which machines hold which dates, *Restore*; the current version is backed up first. To undo a whole send: **History** › that run › **Undo**: the files it changed or deleted come back from the backups, the files it added are removed (only for sends made with backups).',
    },
    keywords: ['yedek', 'backup', 'geri al', 'restore', 'undo', 'eski hâl'],
    page: 'backups',
  },
  {
    id: 'backup-keep',
    topic: 'backup',
    q: { tr: 'Yedekler ne kadar saklanır? Yer kaplıyor', en: 'How long are backups kept? They take space' },
    a: {
      tr: 'Ayarlar › Kopyalama › *Saklanacak yedek* en yeni N yedek klasörünü tutar, eskileri siler (yalnızca ayarlı klasörde; eski araçtan kalan `_…Yedek` klasörlerine dokunulmaz). Yedek klasörünün adı da orada değişir. Senkron işlerinde sürüm klasörü sayı ve gün olarak sınırlanır.',
      en: 'Settings › Copy › *Backups to keep* keeps the newest N backup folders and removes the older ones (only in the configured folder; `_…Yedek` folders of the old tool are left alone). The backup folder name changes there too. Sync jobs limit their versioning folder by count and by days.',
    },
    keywords: ['saklanacak yedek', 'backups to keep', 'yer', 'space', 'temizle'],
    page: 'settings',
  },
  // ---- targets
  {
    id: 'add-machine',
    topic: 'targets',
    q: { tr: 'Yeni bir makine nasıl eklerim?', en: 'How do I add a new machine?' },
    a: {
      tr: 'Hedefler › **Hedef ekle**: kimlik (ör. PC-4), ad, grup, adres, paylaşım kökü (`\\\\adres\\paylaşım` olacak biçimde networkRoot), o makinenin kendi **yerel kökleri** (orada kaynak olduğunda). Bağlantı türü: Windows paylaşımı, klasör/bağlı sürücü ya da SFTP. Yapılandırma ortak dosyada olduğu için bütün makineler yeni girdiyi görür. *Erişimi sına* ile yoklayın.',
      en: 'Targets › **Add target**: id (PC-4, say), name, group, address, share root (networkRoot, so that `\\\\address\\share` is the path), that machine\'s own **local roots** (when it is a source). Connection type: Windows share, folder/mounted drive or SFTP. The configuration is one shared file, so every machine sees the new entry. Probe it with *Test access*.',
    },
    keywords: ['makine ekle', 'add machine', 'hedef ekle', 'grup', 'sftp'],
    page: 'targets',
  },
  {
    id: 'inventory',
    topic: 'targets',
    q: { tr: 'Hangi makinede hangi sürüm var, nasıl görürüm?', en: 'How do I see which machine holds which release?' },
    a: {
      tr: 'Hedefler sayfasındaki **Makine envanteri** tablosu: satırlar gönderilen klasörler, sütunlar makineler, hücrede o makinedeki sürümün etiketi, zamanı ve boyutu (manifestten). En yeni hâlden geride olanlar sarı "geride", hiç almayanlar "eksik", erişilemeyenler kırmızı. Genel bakış sayfasının Envanter kutusu da aynı sayıları gösterir. Paketle uygulanan sürümler de görünür; elle kopyalananlar görünmez.',
      en: 'The **Machine inventory** table on the Targets page: rows are the sent folders, columns the machines, each cell the release label, time and size on that machine (from the manifest). Machines behind the newest state are amber "behind", machines without the folder "missing", unreachable ones red. The Inventory tile on the Overview shows the same numbers. Releases applied from a pack show up; copies by hand do not.',
    },
    keywords: ['envanter', 'inventory', 'sürüm', 'geride', 'eksik'],
    page: 'targets',
  },
  {
    id: 'topology',
    topic: 'targets',
    q: { tr: 'Genel bakıştaki ağ çiziminde ne yapabilirim?', en: 'What can I do in the network view on the Overview?' },
    a: {
      tr: 'Bu bilgisayar solda, gruplar sağda. Gruba giden çizgi erişilebilirliğe göre renkli (yeşil hepsi, sarı bir kısmı, kırmızı kesikli hiçbiri). Röle işaretli, dağıttığı makinelere kesikli çizgiler. Makineye **tıklamak** onu gönderim hedefi yapar / çıkarır (Gönder sayfasındaki seçimle aynı). Makineyi başka bir grubun kutusuna **sürüklemek** grubunu değiştirir (sorar, yapılandırmaya yazar).',
      en: 'This computer on the left, the groups on the right. The line to a group is coloured by reachability (green all, amber some, red dashed none). The relay is marked, with dashed lines to the machines it distributes to. **Clicking** a machine picks or drops it as a send target (the same selection as on the Send page). **Dragging** it into another group\'s box moves it there (asks, writes the configuration).',
    },
    keywords: ['topoloji', 'topology', 'ağ görünümü', 'network view', 'sürükle'],
    page: 'overview',
  },
  // ---- settings
  {
    id: 'shortcuts',
    topic: 'settings',
    q: { tr: 'Klavye kısayolları neler?', en: 'What are the keyboard shortcuts?' },
    a: {
      tr: 'Ctrl K komut paleti • Ctrl / bütün kısayolların listesi • Ctrl , Ayarlar • Ctrl 1…9 sayfalar (1 Genel bakış, 2 Gönder…) • Ctrl Enter Gönder sayfasında inceleme, incelemede gönder (Shift ile deneme) • Ctrl + / − / 0 arayüz ölçeği • Esc açık olanı kapatır • F12 geliştirici araçları • F1 bu yardım botu.',
      en: 'Ctrl K command palette • Ctrl / the list of every shortcut • Ctrl , Settings • Ctrl 1…9 pages (1 Overview, 2 Send…) • Ctrl Enter review on the Send page, send from the review (Shift for a dry run) • Ctrl + / − / 0 UI scale • Esc closes what is open • F12 developer tools • F1 this help bot.',
    },
    keywords: ['kısayol', 'shortcut', 'klavye', 'keyboard', 'tuş'],
    page: 'settings',
  },
  {
    id: 'language-theme',
    topic: 'settings',
    q: { tr: 'Dili ya da temayı nasıl değiştiririm? Yazılar küçük', en: 'How do I change the language or theme? The text is small' },
    a: {
      tr: 'Ayarlar › Görünüm: dil (Türkçe / English / Deutsch / Español / sistemle eşle), tema (koyu / açık / sistem), vurgu rengi, yoğunluk ve **arayüz ölçeği** (%70–175; Ctrl + ile büyüt, Ctrl − küçült, Ctrl 0 sıfırla). Bunlar bu bilgisayara özeldir; kopyalama ve güncelleme ayarları ise ortak yapılandırmaya yazılır.',
      en: 'Settings › Appearance: language (Turkish / English / German / Spanish / follow the system), theme (dark / light / system), accent colour, density and the **UI scale** (70–175%; Ctrl + larger, Ctrl − smaller, Ctrl 0 reset). These belong to this computer; the copy and update settings go to the shared configuration.',
    },
    keywords: ['dil', 'language', 'tema', 'theme', 'ölçek', 'scale', 'büyüt', 'zoom'],
    page: 'settings',
  },
  {
    id: 'license',
    topic: 'settings',
    q: { tr: 'SamSync\'in lisansı ne? Ücretsiz mi, değiştirip dağıtabilir miyim?', en: 'What is SamSync\'s licence? Is it free, may I change and share it?' },
    a: {
      tr: 'SamSync özgür yazılımdır ve **GNU Genel Kamu Lisansı sürüm 3 (GPL-3.0)** ile dağıtılır; telif © 2026 Samet Kurumahmut. Ücretsiz kullanabilir, kaynak kodunu inceleyebilir, değiştirebilir ve dağıtabilirsiniz. Değiştirilmiş ya da değiştirilmemiş bir sürümü başkalarına verirseniz kaynak kodunu da aynı lisansla vermeniz gerekir. Yazılım hiçbir garanti olmadan sunulur. Lisans metni deponun kökündeki `LICENSE` dosyasında ve kurulum klasöründedir; Ayarlar › Hakkında\'dan açılır.',
      en: 'SamSync is free software, released under the **GNU General Public License version 3 (GPL-3.0)**; copyright © 2026 Samet Kurumahmut. You may use it at no cost, read, change and share the source code. If you give a version, changed or not, to others, you must give them the source code under the same licence. It comes without any warranty. The licence text is the `LICENSE` file at the root of the repository and in the installation folder; Settings › About opens it.',
    },
    keywords: ['lisans', 'license', 'licence', 'gpl', 'gnu', 'açık kaynak', 'open source', 'telif', 'copyright', 'ücretsiz', 'free'],
    page: 'settings',
  },
  {
    id: 'update',
    topic: 'settings',
    q: { tr: 'Yeni sürüm nasıl kurulur? Setup\'ı tekrar çalıştırmam gerekir mi?', en: 'How is a new version installed? Do I need to run Setup again?' },
    a: {
      tr: 'Kurulu sürüm (Setup ile kurulan) kendini günceller: açılışta GitHub sürümlerini denetler, indirir, bir sonraki başlatmada kurar; Ayarlar › Güncellemeler\'den elle de denetlenir. Setup\'ı yeniden çalıştırmak gerekmez. Taşınabilir ve zip sürümleri kendini güncellemez. Güncellemeden sonra ilk açılışta **Bu sürümde yeni** kartı değişiklikleri gösterir.',
      en: 'The installed version (from Setup) updates itself: it checks the GitHub releases at start, downloads, installs on the next start; Settings › Updates checks by hand too. Running Setup again is not needed. The portable and zip versions do not update themselves. After an update the **New in this version** card shows the changes on the first start.',
    },
    keywords: ['güncelleme', 'update', 'setup', 'sürüm', 'version', 'kurulum'],
    page: 'settings',
  },
  {
    id: 'config-file',
    topic: 'settings',
    q: { tr: 'config.json nerede, nasıl düzenlenir?', en: 'Where is config.json and how is it edited?' },
    a: {
      tr: 'Yolu Hedefler sayfasındaki Yapılandırma kartında ve Ayarlar › Yapılandırma dosyası\'nda görünür; genelde ağ paylaşımındaki ortak dosyadır (eski PowerShell aracınınkiyle aynı dosya olabilir, alanları korunur). Makineler ve ayarlar arayüzden düzenlenir; **JSON olarak düzenle** bütün dosyayı metin olarak açar, yazarken denetler. Değişiklikleri bütün makineler görür.',
      en: 'The path shows on the Configuration card of the Targets page and under Settings › Configuration file; usually the shared file on a network share (it can be the old PowerShell tool\'s file, its fields are kept). Machines and settings are edited in the UI; **Edit as JSON** opens the whole file as text and checks it as you type. Every machine sees the changes.',
    },
    keywords: ['config', 'yapılandırma', 'json', 'paylaşım'],
    page: 'settings',
  },
  {
    id: 'cli',
    topic: 'settings',
    q: { tr: 'Komut satırından ya da Görev Zamanlayıcı\'dan nasıl kullanırım?', en: 'How do I use it from the command line or Task Scheduler?' },
    a: {
      tr: '`SamSync.exe "C:\\…\\Data\\settings.json"` incelemeyi açar; `--to group:Lab-A,NAS` hedefleri seçer; `--to last --yes` son ayarla pencere açmadan gönderir; `--quick "ad"` kaydedilmiş hızlı gönderimi çalıştırır; `--sync <iş>` bir senkron işini çalıştırır (özet yazar, başarılıysa 0 ile çıkar); `--plan-only` / `--check-only` yazmadan rapor verir. Açık uygulama varsa komut ona iletilir.',
      en: '`SamSync.exe "C:\\…\\Data\\settings.json"` opens the review; `--to group:Lab-A,NAS` picks targets; `--to last --yes` sends with the last settings without a window; `--quick "name"` runs a saved quick send; `--sync <job>` runs a sync job (prints a summary, exits 0 on success); `--plan-only` / `--check-only` report without writing. A running app takes the command over.',
    },
    keywords: ['komut satırı', 'command line', 'cli', 'görev zamanlayıcı', 'task scheduler', 'headless'],
    page: 'settings',
  },
  // ---- trouble
  {
    id: 'unreachable',
    topic: 'trouble',
    q: { tr: 'Makine "erişilemedi" görünüyor', en: 'A machine shows "unreachable"' },
    a: {
      tr: 'Kartta nedeni yazar (yanıt yok / paylaşım açılmadı / izin). Sırayla: makine açık mı ve ağda mı (ping), paylaşım adı ve kök doğru mu (kartta `\\\\adres\\kök` görünür, Explorer\'da açılıyor mu), kullanıcı izni var mı, güvenlik duvarı 445\'i kapatıyor mu. *Erişimi sına* yeniden dener. Erişilemeyen makine gönderimde "hatalı" sayılır; Geçmiş\'ten *Hatalılara yeniden gönder* ile sonra yollanır. İzlemelerde "erişilemeyenlere yeniden dene" seçeneği var.',
      en: 'The card says why (no answer / share not opened / permission). In order: is the machine on and on the network (ping), are the share name and root right (the card shows `\\\\address\\root`; does it open in Explorer), does the user have permission, is a firewall blocking 445. *Test access* tries again. An unreachable machine counts as failed in a send; *Send again to the failed ones* in History sends later. Watches have a "retry unreachable" option.',
    },
    keywords: ['erişilemedi', 'unreachable', 'bağlanamadı', 'ping', 'paylaşım', 'izin'],
    page: 'targets',
  },
  {
    id: 'in-use',
    topic: 'trouble',
    q: { tr: '"Dosya kullanımda" hatası alıyorum', en: 'I get a "file in use" error' },
    a: {
      tr: 'Hedefte bir program (çalışan uygulama, yüklü bir DLL) dosyayı tutuyor. SamSync 1 MB ve üstü dosyalarda bunu kopyalamadan önce anlar ve yeniden denemez. Hedefteki programı kapatıp Geçmiş\'ten *Hatalılara yeniden gönder* deyin. Bir gönderim kullanımda hatası verdiyse öbür dosyalar yine de yazılmıştır (kısmi sonuç).',
      en: 'A program on the target (the running application, a loaded DLL) holds the file. For files of 1 MB and more SamSync notices before copying and does not retry. Close the program on the target and use *Send again to the failed ones* in History. The other files of that send were still written (a partial result).',
    },
    keywords: ['kullanımda', 'in use', 'eperm', 'ebusy', 'kilitli dosya'],
    page: 'history',
  },
  {
    id: 'partial-resume',
    topic: 'trouble',
    q: { tr: 'Büyük dosya yarıda kaldı; baştan mı başlar?', en: 'A big file broke off half way; does it start over?' },
    a: {
      tr: 'Hayır. 8 MB ve üstü dosyalar sabit adlı geçici dosyaya yazılır; iptal, kopan bağlantı ya da kapanan uygulama sonrası bir sonraki gönderim parçanın kuyruğunu kaynakla karşılaştırır ve **kaldığı yerden sürer** (günlükte "kaldığı yerden sürüyor"). Kaynak o arada değiştiyse baştan yazar. İptal düğmesi kopyayı anında keser.',
      en: 'No. Files of 8 MB and more are written under a fixed temporary name; after a cancel, a dropped link or a closed app, the next send checks the tail of the partial file against the source and **continues from where it stopped** (the log says so). If the source changed meanwhile it starts over. Cancel stops the copy at once.',
    },
    keywords: ['yarım', 'resume', 'devam', 'iptal', 'cancel', 'kaldığı yerden'],
    page: 'send',
  },
  {
    id: 'blank-window',
    topic: 'trouble',
    q: { tr: 'Pencere boş açılıyor ya da arayüz hata verdi', en: 'The window opens blank or the UI shows an error' },
    a: {
      tr: 'Arayüz bir hata yakalarsa hatayı, *Yeniden yükle*, *Tanı klasörü oluştur* ve *Hatayı kopyala* düğmeleriyle gösterir; çoğu zaman yeniden yüklemek yeter. Sürerse Ayarlar › Hakkında › **Tanılama klasörü oluştur…** ile günlükleri toplayıp paylaşın (parolalar dahil edilmez). Pencere tamamen boşsa F12 geliştirici araçlarını açın ya da uygulamayı tepsiden kapatıp yeniden başlatın.',
      en: 'When the UI catches an error it shows it with *Reload*, *Create diagnostics folder* and *Copy error*; reloading is usually enough. If it keeps happening, collect the logs with Settings › About › **Create diagnostics folder…** and share them (no passwords inside). For a fully blank window open the F12 developer tools, or quit from the tray and start again.',
    },
    keywords: ['boş pencere', 'blank', 'çöktü', 'crash', 'hata', 'tanı', 'diagnostics', 'günlük', 'log'],
    page: 'settings',
  },
  {
    id: 'logs',
    topic: 'trouble',
    q: { tr: 'Günlükler nerede?', en: 'Where are the logs?' },
    a: {
      tr: 'Ayarlar › Hakkında › *Günlüğü aç* uygulama günlüğünü (`root.log`) açar; *Veri klasörü* ayarların, geçmişin ve günlüklerin bulunduğu klasörü. Her çalıştırmanın kendi günlüğü Geçmiş › çalıştırma › Günlük sekmesindedir (`history/<id>.log`). Her gönderim için CSV rapor da yazılır.',
      en: 'Settings › About › *Open log* opens the app log (`root.log`); *Data folder* the folder with the settings, history and logs. Each run has its own log under History › run › Log tab (`history/<id>.log`). A CSV report is written for every send too.',
    },
    keywords: ['günlük', 'log', 'rapor', 'csv', 'veri klasörü'],
    page: 'history',
  },
];
