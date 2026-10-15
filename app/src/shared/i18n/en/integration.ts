// Language setting, number/date formatting, the Electron entry point, Explorer menu, Notepad++ and the
// one-click sends they start.
import type { Dict } from '../types';
import { pl } from '../types';

const d: Dict = {
  Dil: 'Language',
  'Sistemle eşle': 'Match system',
  'Bilgisayarın dili: {lang}': "Computer's language: {lang}",
  'az önce': 'just now',
  '{s} sn': '{s} s',
  '{m} dk {s} sn': '{m} min {s} s',
  '{h} sa {m} dk': '{h} h {m} min',

  // main process
  'Bilinmeyen işlem: {method}': 'Unknown operation: {method}',
  'SamSync arka planda çalışıyor': 'SamSync is running in the background',
  'İzleme ve zamanlanmış işler sürüyor. Tepsideki simgeden açabilir ya da çıkabilirsiniz.': 'Watches and scheduled jobs keep running. Open or quit it from the tray icon.',

  // menu entries
  'Tümüne gönder': 'Send to all',
  'İncele ve gönder…': 'Review and send…',
  'Son ayarla gönder': 'Send with last settings',
  'Yedekten geri al…': 'Restore from backup…',
  '{name} (profil)': '{name} (profile)',
  '{group} - Tümü': '{group} - All',

  // Explorer / Notepad++ log and warnings
  'Explorer menüsü': 'Explorer menu',
  'Menü yazıldı: {n} girdi; alt menüsü açık gruplar: {open}; tek girdi olan gruplar: {closed}': 'Menu written: {n} entries; groups with a submenu: {open}; groups as one entry: {closed}',
  'Menüde 16 girdiden fazlası var; Windows bazılarını göstermeyebilir': 'The menu has more than 16 entries; Windows may not show all of them',
  'Menü kaldırıldı': 'Menu removed',
  'Menü yazılamadı': 'Could not write the menu',
  '{dir} içine menü ve kısayollar yazıldı': 'Menu and shortcuts written to {dir}',
  '{dir} içinden menü ve kısayollar kaldırıldı': 'Menu and shortcuts removed from {dir}',
  'Notepad++ ayarları yazılamadı': 'Could not write the Notepad++ settings',
  'Notepad++ kapandı; menü ve kısayollar yeniden yazılıyor': 'Notepad++ closed; writing the menu and shortcuts again',
  'Tanınmayan tuş: {key} ({text})': 'Unknown key: {key} ({text})',
  'Kısayolda tek bir tuş olmalı: {text}': 'A shortcut needs exactly one key: {text}',
  'Harf ve rakamlar en az bir değiştirici tuş ister (Ctrl, Alt, Shift): {text}': 'Letters and digits need at least one modifier key (Ctrl, Alt, Shift): {text}',
  'Notepad++ dosyası tanınmadı: </NotepadPlus> yok': 'Notepad++ file not recognised: no </NotepadPlus>',
  'Notepad++ dosyası tanınmadı: </{tag}> yok': 'Notepad++ file not recognised: no </{tag}>',
  'Kısayol tanımı menüde olmayan bir girdiye bağlı: {id} (geçerli olanlar: {ids})': 'Shortcut for an entry that is not in the menu: {id} (valid: {ids})',
  '{text} iki girdiye atanmış ({a}, {b}); yalnızca ilki kullanıldı': '{text} is assigned to two entries ({a}, {b}); only the first is used',
  '{text} Notepad++ içinde başka bir komutta da tanımlı: {other}': '{text} is also used by another Notepad++ command: {other}',
  '{label}: komut {n} karakter, Notepad++ en çok {max} kabul ediyor; girdi eklenmedi': '{label}: the command is {n} characters, Notepad++ accepts at most {max}; entry left out',
  'Notepad++ {version} çok eski; en az 8.4.8 gerekiyor': 'Notepad++ {version} is too old; 8.4.8 or later is needed',
  'shortcuts.xml imzalanamadı; Notepad++ içinde Çalıştır > Validate shortcuts.xml komutunu bir kez kullanın': 'Could not sign shortcuts.xml; run Run > Validate shortcuts.xml once in Notepad++',

  // Settings: right-click menus
  'Sağ tık menüleri': 'Right-click menus',
  'Explorer ve Notepad++ içinden tek tıkla gönderim': 'One-click sending from Explorer and Notepad++',
  'Bu özellik yalnızca masaüstü uygulamasında kullanılabilir.': 'This is only available in the desktop app.',
  'Dosya ve klasörlere sağ tıklayınca “SamSync”: tümüne, son ayarla, profile, gruba ya da makineye tek tıkla gönder; incele ve gönder; yedekten geri al.':
    'Right-click files and folders for “SamSync”: one click sends to all, with the last settings, to a profile, a group or a machine; review and send; restore from backup.',
  'Makineler menüde': 'Machines in the menu',
  'Alt menüsüyle: {groups}': 'With a submenu: {groups}',
  'Tek girdi (bütün gruba gönderir): {groups}': 'One entry (sends to the whole group): {groups}',
  '100 öğeye kadar seçim desteklenir; Explorer her öğe için uygulamayı bir kez başlatır, hepsi tek gönderimde toplanır. Windows 11’de “Daha fazla seçenek göster” altında görünür.':
    'Selections of up to 100 items work; Explorer starts the app once per item and they are merged into one send. On Windows 11 it is under “Show more options”.',
  'Sekmeye sağ tıklayınca “SamSync” klasörü, Çalıştır menüsünde aynı komutlar ve kısayollar (Ctrl+Alt+W: son ayarla gönder).':
    'A “SamSync” folder when you right-click a tab, the same commands in the Run menu, and shortcuts (Ctrl+Alt+W: send with last settings).',
  'Bu bilgisayarda Notepad++ bulunamadı.': 'Notepad++ was not found on this computer.',
  taşınabilir: 'portable',
  açık: 'open',
  'Notepad++ açıkken değişti; kapanırken kendi ayarlarını geri yazar. Notepad++ kapanınca SamSync menüyü ve kısayolları yeniden yazar.':
    'Changed while Notepad++ was open; it writes its own settings back when it closes. Once Notepad++ has closed, SamSync writes the menu and shortcuts again.',
  Sığdıkça: 'While they fit',
  'Windows menüsünde 16 girdiye kadar: önce bu makinenin grubu, sonra sığarsa diğer gruplar alt menüyle':
    "Up to 16 entries in the Windows menu: this machine's group first, then the other groups with a submenu if they fit",
  'Her zaman': 'Always',
  'Bütün grupları alt menüsüyle göster': 'Show every group with its submenu',
  'Yalnızca gruplar': 'Groups only',
  'Gruplar tek girdi olarak bütün gruba gönderir; tek tek makineler yok': 'Each group is one entry that sends to the whole group; no single machines',
  'Notepad++ kısayolları': 'Notepad++ shortcuts',
  'Kısayol ekle': 'Add shortcut',
  'Ctrl, Alt, Shift ile bir tuş: harf, rakam, F1–F24, Insert, Delete, Home, End, PageUp, PageDown, yön tuşları. Paylaşılan yapılandırmaya yazılır, bütün makinelerde geçerlidir.':
    'Ctrl, Alt, Shift with one key: a letter, digit, F1–F24, Insert, Delete, Home, End, PageUp, PageDown or an arrow key. Saved in the shared configuration, so it applies on every machine.',
  'Menüden gelen öğeler:': 'Items from the menu:',
  'Ayna kipi hedeflerde toplam {n} öğe silecek. Gönderim sürsün mü?': pl('Mirror mode will delete {n} item on the targets. Continue sending?', 'Mirror mode will delete {n} items in total on the targets. Continue sending?'),
  'Rapor yazılamadı': 'Could not write the report',
  'Hedefe erişilemiyor': 'Target unreachable',

  // updates
  'Bu kaynakta henüz yayımlanmış bir sürüm yok.': 'No version has been published from this source yet.',
  'Bilinmeyen hata': 'Unknown error',

  // one-click sends
  'Son ayar': 'Last settings',
  'Profil: {name}': 'Profile: {name}',
  'Son gönderim ayarı yok': 'No last send settings yet',
  'Önce bir kez “İncele ve gönder” ile gönderin; sonra aynı hedefler ve seçenekler tek tıkla kullanılır.': 'Send once with “Review and send” first; after that the same targets and options are one click away.',
  'Gönderim hedefte silme yapacak': 'This send deletes on the targets',
  '{n} öğe silinecek; göndermeden önce gözden geçirin.': pl('{n} item will be deleted; review it before sending.', '{n} items will be deleted; review them before sending.'),
};

export default d;
