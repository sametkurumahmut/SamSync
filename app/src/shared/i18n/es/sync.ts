// Folder sync (Spanish): ignore files, --sync without a window, job files, the Recycle Bin and versions by age.
import type { Dict } from '../types';
import { pl } from '../types';

const d: Dict = {
  // ignore files
  '{path} okunamadı: {error}': 'No se pudo leer {path}: {error}',

  // Recycle Bin and versioning
  'Geri dönüşüm kutusu kullanılamadı ({error}); eski hâller yedek klasörüne taşınacak.': 'No se pudo usar la Papelera de reciclaje ({error}); las versiones anteriores se moverán a la carpeta de copia de seguridad.',
  '{n} eski hâl geri dönüşüm kutusuna taşındı': pl('{n} versión anterior movida a la Papelera de reciclaje', '{n} versiones anteriores movidas a la Papelera de reciclaje'),
  'Yarım kalmış kopyalardan {n} geçici dosya silindi': pl('Se eliminó {n} archivo temporal de copias interrumpidas', 'Se eliminaron {n} archivos temporales de copias interrumpidas'),
  'Eski yedekler temizlenemedi: {error}': 'No se pudieron limpiar las copias de seguridad antiguas: {error}',
  'Geri dönüşüm kutusu': 'Papelera de reciclaje',
  'Bu makinedeki klasörlerde eski hâller geri dönüşüm kutusuna gider;\nağ yollarında ve hedef makinelerde yedek klasörüne taşınır':
    'En las carpetas de este equipo las versiones anteriores van a la Papelera de reciclaje;\nen rutas de red y en equipos de destino se mueven a la carpeta de copia de seguridad',
  'Saklama süresi (gün)': 'Conservar durante (días)',
  'Bundan eski sürümler başarılı bir çalışmadan sonra silinir.\nBoş ya da 0: yaş sınırı yok': 'Las versiones más antiguas se eliminan tras una ejecución correcta.\nVacío o 0: sin límite de antigüedad',
  'Silinen ve üzerine yazılan dosyalar bu makinedeki klasörlerde geri dönüşüm kutusuna, öbür taraflarda {folder} klasörüne taşınır.':
    'Los archivos eliminados y sobrescritos van a la Papelera de reciclaje en las carpetas de este equipo, y a la carpeta {folder} en los demás lados.',

  // job files
  'Bu dosya bir SamSync senkron işi değil.': 'Este archivo no es una tarea de sincronización de SamSync.',
  'Senkron işinin klasör çiftleri eksik ya da bozuk.': 'Los pares de carpetas de la tarea de sincronización faltan o están dañados.',
  'İçe aktarılan iş': 'Tarea importada',
  '{name} dışa aktarıldı: {path}': '{name} se exportó: {path}',
  '{name} içe aktarıldı: {path}': '{name} se importó: {path}',
  'SamSync senkron işi': 'Tarea de sincronización de SamSync',
  'İçe aktarılacak senkron işi': 'Tarea de sincronización que importar',
  'Senkron işi içe aktarıldı': 'Tarea de sincronización importada',
  'İçe aktar…': 'Importar…',
  'Senkron işini dışa aktar': 'Exportar la tarea de sincronización',
  'Senkron işi dışa aktarıldı': 'Tarea de sincronización exportada',
  'Dışa aktarılamadı': 'No se pudo exportar',
  'İşi başka bir yapılandırmaya taşımak için dosyaya yazar': 'Escribe la tarea en un archivo para llevarla a otra configuración',

  // --sync
  '“{name}” adında {n} iş var; kimliğiyle verin: {ids}': 'Hay {n} tareas llamadas “{name}”; indica la que quieras por su id: {ids}',
  'Senkron işi verilmedi. Örnek: SamSync.exe --sync "Gece yedeği"': 'No se indicó ninguna tarea de sincronización. Ejemplo: SamSync.exe --sync "Copia nocturna"',
  'Komut satırı: {name}': 'Línea de comandos: {name}',
  'Senkron işi: {name} ({id})': 'Tarea de sincronización: {name} ({id})',
  'Çakışma: {n} (dokunulmadı)': 'Conflictos: {n} (sin tocar)',
  'Hata: {n}': 'Errores: {n}',
  '… ve {n} hata daha': pl('… y {n} error más', '… y {n} errores más'),
  'Senkron {name}: işlem {ops}, hata {errors}': 'Sincronización {name}: operaciones {ops}, errores {errors}',
  'İki sürüm de saklanmıştı; bir taraf değişene dek dokunulmaz': 'Se conservaron las dos versiones; no se toca nada hasta que cambie un lado',
  'İkisini de sakla': 'Conservar ambas',
  'Çakışmaları tek tek ya da toplu çözün: sol, sağ, ikisini de sakla': 'Resuelve los conflictos uno a uno o todos a la vez: izquierda, derecha, conservar ambas',
  '{n} çakışmayı çöz…': pl('Resolver {n} conflicto…', 'Resolver {n} conflictos…'),
  'Çakışmaları çöz': 'Resolver conflictos',
  '{done}/{n} karar verildi; karar verilmeyenlere dokunulmaz.': '{done}/{n} decididos; los pendientes no se tocan.',
  'Hepsine:': 'A todos:',
  'Tarihi daha yeni olan taraf kazanır; tarihleri aynı olanlara dokunulmaz': 'Gana el lado con la fecha más reciente; los de fecha igual no se tocan',
  'Yeni olan kazansın': 'Gana el más reciente',
  'Sol kazansın': 'Gana la izquierda',
  'Sağ kazansın': 'Gana la derecha',
  'Her iki tarafa öbürünün sürümü "ad (sol).uzantı" / "ad (sağ).uzantı" olarak yazılır; hiçbir şey silinmez': 'A cada lado se le escribe la versión del otro como "nombre (izquierda).ext" / "nombre (derecha).ext"; no se elimina nada',
  'Hepsini atla': 'Omitir todos',
  'daha yeni': 'más reciente',
};

export default d;
