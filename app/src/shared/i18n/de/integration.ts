// German for the language setting, number/date formatting, the Electron entry point, Explorer menu, Notepad++ and
// the one-click sends they start.
import type { Dict } from '../types';
import { pl } from '../types';

const d: Dict = {
  Dil: 'Sprache',
  'Sistemle eşle': 'Dem System folgen',
  'Bilgisayarın dili: {lang}': 'Sprache des Computers: {lang}',
  'az önce': 'gerade eben',
  '{s} sn': '{s} s',
  '{m} dk {s} sn': '{m} Min. {s} s',
  '{h} sa {m} dk': '{h} Std. {m} Min.',

  // main process
  'Bilinmeyen işlem: {method}': 'Unbekannter Vorgang: {method}',
  'SamSync arka planda çalışıyor': 'SamSync läuft im Hintergrund',
  'İzleme ve zamanlanmış işler sürüyor. Tepsideki simgeden açabilir ya da çıkabilirsiniz.': 'Überwachungen und geplante Aufträge laufen weiter. Über das Symbol im Infobereich können Sie SamSync öffnen oder beenden.',

  // menu entries
  'Tümüne gönder': 'An alle senden',
  'İncele ve gönder…': 'Prüfen und senden…',
  'Son ayarla gönder': 'Mit letzten Einstellungen senden',
  'Yedekten geri al…': 'Aus Sicherung wiederherstellen…',
  '{name} (profil)': '{name} (Profil)',
  '{group} - Tümü': '{group} - Alle',

  // Explorer / Notepad++ log and warnings
  'Explorer menüsü': 'Explorer-Menü',
  'Menü yazıldı: {n} girdi; alt menüsü açık gruplar: {open}; tek girdi olan gruplar: {closed}': 'Menü geschrieben: {n} Einträge; Gruppen mit Untermenü: {open}; Gruppen als ein Eintrag: {closed}',
  'Menüde 16 girdiden fazlası var; Windows bazılarını göstermeyebilir': 'Das Menü hat mehr als 16 Einträge; Windows zeigt möglicherweise nicht alle an',
  'Menü kaldırıldı': 'Menü entfernt',
  'Menü yazılamadı': 'Das Menü konnte nicht geschrieben werden',
  '{dir} içine menü ve kısayollar yazıldı': 'Menü und Tastenkürzel nach {dir} geschrieben',
  '{dir} içinden menü ve kısayollar kaldırıldı': 'Menü und Tastenkürzel aus {dir} entfernt',
  'Notepad++ ayarları yazılamadı': 'Die Notepad++-Einstellungen konnten nicht geschrieben werden',
  'Notepad++ kapandı; menü ve kısayollar yeniden yazılıyor': 'Notepad++ wurde geschlossen; Menü und Tastenkürzel werden neu geschrieben',
  'Tanınmayan tuş: {key} ({text})': 'Unbekannte Taste: {key} ({text})',
  'Kısayolda tek bir tuş olmalı: {text}': 'Ein Tastenkürzel braucht genau eine Taste: {text}',
  'Harf ve rakamlar en az bir değiştirici tuş ister (Ctrl, Alt, Shift): {text}': 'Buchstaben und Ziffern brauchen mindestens eine Zusatztaste (Ctrl, Alt, Shift): {text}',
  'Notepad++ dosyası tanınmadı: </NotepadPlus> yok': 'Notepad++-Datei nicht erkannt: </NotepadPlus> fehlt',
  'Notepad++ dosyası tanınmadı: </{tag}> yok': 'Notepad++-Datei nicht erkannt: </{tag}> fehlt',
  'Kısayol tanımı menüde olmayan bir girdiye bağlı: {id} (geçerli olanlar: {ids})': 'Tastenkürzel für einen Eintrag, der nicht im Menü ist: {id} (gültig: {ids})',
  '{text} iki girdiye atanmış ({a}, {b}); yalnızca ilki kullanıldı': '{text} ist zwei Einträgen zugewiesen ({a}, {b}); nur der erste wird verwendet',
  '{text} Notepad++ içinde başka bir komutta da tanımlı: {other}': '{text} wird in Notepad++ auch von einem anderen Befehl verwendet: {other}',
  '{label}: komut {n} karakter, Notepad++ en çok {max} kabul ediyor; girdi eklenmedi': '{label}: Der Befehl hat {n} Zeichen, Notepad++ akzeptiert höchstens {max}; Eintrag weggelassen',
  'Notepad++ {version} çok eski; en az 8.4.8 gerekiyor': 'Notepad++ {version} ist zu alt; mindestens 8.4.8 wird benötigt',
  'shortcuts.xml imzalanamadı; Notepad++ içinde Çalıştır > Validate shortcuts.xml komutunu bir kez kullanın': 'shortcuts.xml konnte nicht signiert werden; führen Sie in Notepad++ einmal Ausführen > Validate shortcuts.xml aus',

  // Settings: right-click menus
  'Sağ tık menüleri': 'Rechtsklick-Menüs',
  'Explorer ve Notepad++ içinden tek tıkla gönderim': 'Senden mit einem Klick aus Explorer und Notepad++',
  'Bu özellik yalnızca masaüstü uygulamasında kullanılabilir.': 'Dies ist nur in der Desktop-App verfügbar.',
  'Dosya ve klasörlere sağ tıklayınca “SamSync”: tümüne, son ayarla, profile, gruba ya da makineye tek tıkla gönder; incele ve gönder; yedekten geri al.':
    'Rechtsklick auf Dateien und Ordner ergibt „SamSync“: mit einem Klick an alle senden, mit den letzten Einstellungen, an ein Profil, eine Gruppe oder einen Rechner; prüfen und senden; aus einer Sicherung wiederherstellen.',
  'Makineler menüde': 'Rechner im Menü',
  'Alt menüsüyle: {groups}': 'Mit Untermenü: {groups}',
  'Tek girdi (bütün gruba gönderir): {groups}': 'Ein Eintrag (sendet an die ganze Gruppe): {groups}',
  '100 öğeye kadar seçim desteklenir; Explorer her öğe için uygulamayı bir kez başlatır, hepsi tek gönderimde toplanır. Windows 11’de “Daha fazla seçenek göster” altında görünür.':
    'Bis zu 100 ausgewählte Elemente werden unterstützt; Explorer startet die App einmal pro Element, und alle werden zu einer Übertragung zusammengeführt. Unter Windows 11 erscheint es unter „Weitere Optionen anzeigen“.',
  'Sekmeye sağ tıklayınca “SamSync” klasörü, Çalıştır menüsünde aynı komutlar ve kısayollar (Ctrl+Alt+W: son ayarla gönder).':
    'Ein Ordner „SamSync“ beim Rechtsklick auf einen Tab, dieselben Befehle im Menü „Ausführen“ und Tastenkürzel (Ctrl+Alt+W: mit letzten Einstellungen senden).',
  'Bu bilgisayarda Notepad++ bulunamadı.': 'Auf diesem Computer wurde Notepad++ nicht gefunden.',
  taşınabilir: 'portabel',
  açık: 'geöffnet',
  'Notepad++ açıkken değişti; kapanırken kendi ayarlarını geri yazar. Notepad++ kapanınca SamSync menüyü ve kısayolları yeniden yazar.':
    'Wurde geändert, während Notepad++ geöffnet war; es schreibt seine eigenen Einstellungen beim Schließen zurück. Sobald Notepad++ geschlossen ist, schreibt SamSync Menü und Tastenkürzel erneut.',
  Sığdıkça: 'Solange es passt',
  'Windows menüsünde 16 girdiye kadar: önce bu makinenin grubu, sonra sığarsa diğer gruplar alt menüyle':
    'Bis zu 16 Einträge im Windows-Menü: zuerst die Gruppe dieses Rechners, danach die anderen Gruppen mit Untermenü, sofern sie passen',
  'Her zaman': 'Immer',
  'Bütün grupları alt menüsüyle göster': 'Jede Gruppe mit ihrem Untermenü anzeigen',
  'Yalnızca gruplar': 'Nur Gruppen',
  'Gruplar tek girdi olarak bütün gruba gönderir; tek tek makineler yok': 'Jede Gruppe ist ein Eintrag, der an die ganze Gruppe sendet; keine einzelnen Rechner',
  'Notepad++ kısayolları': 'Notepad++-Tastenkürzel',
  'Kısayol ekle': 'Tastenkürzel hinzufügen',
  'Ctrl, Alt, Shift ile bir tuş: harf, rakam, F1–F24, Insert, Delete, Home, End, PageUp, PageDown, yön tuşları. Paylaşılan yapılandırmaya yazılır, bütün makinelerde geçerlidir.':
    'Ctrl, Alt, Shift mit einer Taste: ein Buchstabe, eine Ziffer, F1–F24, Insert, Delete, Home, End, PageUp, PageDown oder eine Pfeiltaste. Wird in der gemeinsamen Konfiguration gespeichert und gilt daher auf jedem Rechner.',
  'Menüden gelen öğeler:': 'Elemente aus dem Menü:',
  'Ayna kipi hedeflerde toplam {n} öğe silecek. Gönderim sürsün mü?': pl('Der Modus „Spiegeln“ löscht auf den Zielen {n} Element. Mit dem Senden fortfahren?', 'Der Modus „Spiegeln“ löscht auf den Zielen insgesamt {n} Elemente. Mit dem Senden fortfahren?'),
  'Rapor yazılamadı': 'Der Bericht konnte nicht geschrieben werden',
  'Hedefe erişilemiyor': 'Ziel nicht erreichbar',

  // updates
  'Bu kaynakta henüz yayımlanmış bir sürüm yok.': 'Aus dieser Quelle wurde noch keine Version veröffentlicht.',
  'Bilinmeyen hata': 'Unbekannter Fehler',

  // one-click sends
  'Son ayar': 'Letzte Einstellungen',
  'Profil: {name}': 'Profil: {name}',
  'Son gönderim ayarı yok': 'Noch keine Einstellungen der letzten Übertragung',
  'Önce bir kez “İncele ve gönder” ile gönderin; sonra aynı hedefler ve seçenekler tek tıkla kullanılır.': 'Senden Sie zuerst einmal mit „Prüfen und senden“; danach sind dieselben Ziele und Optionen mit einem Klick verfügbar.',
  'Gönderim hedefte silme yapacak': 'Diese Übertragung löscht auf den Zielen',
  '{n} öğe silinecek; göndermeden önce gözden geçirin.': pl('{n} Element wird gelöscht; prüfen Sie es vor dem Senden.', '{n} Elemente werden gelöscht; prüfen Sie sie vor dem Senden.'),
  'Masaüstü bildirimi bu sistemde desteklenmiyor': 'Desktop-Benachrichtigungen werden auf diesem System nicht unterstützt',
  'Masaüstü bildirimi gösterilemedi: {error}': 'Die Desktop-Benachrichtigung ließ sich nicht anzeigen: {error}',
  'Ekran görüntüsü': 'Bildschirmfoto',
  'Alınamadı ({attempt}/{max}): {error}': 'Konnte nicht aufgenommen werden ({attempt}/{max}): {error}',
};

export default d;
