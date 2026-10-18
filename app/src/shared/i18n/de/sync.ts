// German for folder sync: ignore files, --sync without a window, job files, the Recycle Bin and versions by age.
import type { Dict } from '../types';
import { pl } from '../types';

const d: Dict = {
  // ignore files
  '{path} okunamadı: {error}': '{path} konnte nicht gelesen werden: {error}',

  // Recycle Bin and versioning
  'Geri dönüşüm kutusu kullanılamadı ({error}); eski hâller yedek klasörüne taşınacak.': 'Der Papierkorb konnte nicht verwendet werden ({error}); alte Versionen kommen stattdessen in den Sicherungsordner.',
  '{n} eski hâl geri dönüşüm kutusuna taşındı': pl('{n} alte Version in den Papierkorb verschoben', '{n} alte Versionen in den Papierkorb verschoben'),
  'Eski yedekler temizlenemedi: {error}': 'Alte Sicherungen konnten nicht bereinigt werden: {error}',
  'Geri dönüşüm kutusu': 'Papierkorb',
  'Bu makinedeki klasörlerde eski hâller geri dönüşüm kutusuna gider;\nağ yollarında ve hedef makinelerde yedek klasörüne taşınır':
    'In Ordnern auf diesem Rechner kommen alte Versionen in den Papierkorb;\nauf Netzwerkpfaden und Zielrechnern kommen sie in den Sicherungsordner',
  'Saklama süresi (gün)': 'Aufbewahrungsdauer (Tage)',
  'Bundan eski sürümler başarılı bir çalışmadan sonra silinir.\nBoş ya da 0: yaş sınırı yok': 'Ältere Versionen werden nach einem erfolgreichen Lauf entfernt.\nLeer oder 0: keine Altersgrenze',
  'Silinen ve üzerine yazılan dosyalar bu makinedeki klasörlerde geri dönüşüm kutusuna, öbür taraflarda {folder} klasörüne taşınır.':
    'Gelöschte und überschriebene Dateien kommen in Ordnern auf diesem Rechner in den Papierkorb und auf den anderen Seiten in den Ordner {folder}.',

  // job files
  'Bu dosya bir SamSync senkron işi değil.': 'Diese Datei ist kein SamSync-Sync-Auftrag.',
  'Senkron işinin klasör çiftleri eksik ya da bozuk.': 'Die Ordnerpaare des Sync-Auftrags fehlen oder sind fehlerhaft.',
  'İçe aktarılan iş': 'Importierter Auftrag',
  '{name} dışa aktarıldı: {path}': '{name} exportiert: {path}',
  '{name} içe aktarıldı: {path}': '{name} importiert: {path}',
  'SamSync senkron işi': 'SamSync-Sync-Auftrag',
  'İçe aktarılacak senkron işi': 'Zu importierender Sync-Auftrag',
  'Senkron işi içe aktarıldı': 'Sync-Auftrag importiert',
  'İçe aktar…': 'Importieren…',
  'Senkron işini dışa aktar': 'Sync-Auftrag exportieren',
  'Senkron işi dışa aktarıldı': 'Sync-Auftrag exportiert',
  'Dışa aktarılamadı': 'Export fehlgeschlagen',
  'İşi başka bir yapılandırmaya taşımak için dosyaya yazar': 'Schreibt den Auftrag in eine Datei, um ihn in eine andere Konfiguration zu übernehmen',

  // --sync
  '“{name}” adında {n} iş var; kimliğiyle verin: {ids}': '{n} Aufträge heißen „{name}“; geben Sie stattdessen die ID an: {ids}',
  'Senkron işi verilmedi. Örnek: SamSync.exe --sync "Gece yedeği"': 'Kein Sync-Auftrag angegeben. Beispiel: SamSync.exe --sync "Nächtliche Sicherung"',
  'Komut satırı: {name}': 'Befehlszeile: {name}',
  'Senkron işi: {name} ({id})': 'Sync-Auftrag: {name} ({id})',
  'Çakışma: {n} (dokunulmadı)': 'Konflikte: {n} (unberührt)',
  'Hata: {n}': 'Fehler: {n}',
  '… ve {n} hata daha': pl('… und {n} weiterer Fehler', '… und {n} weitere Fehler'),
  'Senkron {name}: işlem {ops}, hata {errors}': 'Sync {name}: Vorgänge {ops}, Fehler {errors}',
  'İki sürüm de saklanmıştı; bir taraf değişene dek dokunulmaz': 'Beide Versionen wurden behalten; es passiert nichts, bis sich eine Seite ändert',
  'İkisini de sakla': 'Beide behalten',
  'Çakışmaları tek tek ya da toplu çözün: sol, sağ, ikisini de sakla': 'Lösen Sie die Konflikte einzeln oder gesammelt: links, rechts, beide behalten',
  '{n} çakışmayı çöz…': '{n} Konflikte lösen…',
  'Çakışmaları çöz': 'Konflikte lösen',
  '{done}/{n} karar verildi; karar verilmeyenlere dokunulmaz.': '{done}/{n} entschieden; die noch offenen bleiben unberührt.',
  'Hepsine:': 'Für alle:',
  'Tarihi daha yeni olan taraf kazanır; tarihleri aynı olanlara dokunulmaz': 'Die Seite mit dem neueren Datum gewinnt; bei gleichem Datum passiert nichts',
  'Yeni olan kazansın': 'Neuere gewinnt',
  'Sol kazansın': 'Links gewinnt',
  'Sağ kazansın': 'Rechts gewinnt',
  'Her iki tarafa öbürünün sürümü "ad (sol).uzantı" / "ad (sağ).uzantı" olarak yazılır; hiçbir şey silinmez': 'Jede Seite erhält die Version der anderen als "Name (links).ext" / "Name (rechts).ext"; nichts wird gelöscht',
  'Hepsini atla': 'Alle überspringen',
  'daha yeni': 'neuer',
};

export default d;
