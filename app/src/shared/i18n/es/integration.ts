// Spanish for the language setting, number/date formatting, the Electron entry point, Explorer menu, Notepad++
// and the one-click sends they start.
import type { Dict } from '../types';
import { pl } from '../types';

const d: Dict = {
  Dil: 'Idioma',
  'Sistemle eşle': 'Igual que el sistema',
  'Bilgisayarın dili: {lang}': 'Idioma del equipo: {lang}',
  'az önce': 'ahora mismo',
  '{s} sn': '{s} s',
  '{m} dk {s} sn': '{m} min {s} s',
  '{h} sa {m} dk': '{h} h {m} min',

  // main process
  'Bilinmeyen işlem: {method}': 'Operación desconocida: {method}',
  'SamSync arka planda çalışıyor': 'SamSync se está ejecutando en segundo plano',
  'İzleme ve zamanlanmış işler sürüyor. Tepsideki simgeden açabilir ya da çıkabilirsiniz.': 'Las vigilancias y las tareas programadas siguen activas. Puedes abrirlo o salir desde el icono de la bandeja del sistema.',

  // menu entries
  'Tümüne gönder': 'Enviar a todos',
  'İncele ve gönder…': 'Revisar y enviar…',
  'Son ayarla gönder': 'Enviar con los últimos ajustes',
  'Yedekten geri al…': 'Restaurar desde una copia de seguridad…',
  '{name} (profil)': '{name} (perfil)',
  '{group} - Tümü': '{group} - Todos',

  // Explorer / Notepad++ log and warnings
  'Explorer menüsü': 'Menú de Explorer',
  'Menü yazıldı: {n} girdi; alt menüsü açık gruplar: {open}; tek girdi olan gruplar: {closed}': 'Menú escrito: {n} entradas; grupos con submenú: {open}; grupos como una sola entrada: {closed}',
  'Menüde 16 girdiden fazlası var; Windows bazılarını göstermeyebilir': 'El menú tiene más de 16 entradas; puede que Windows no muestre todas',
  'Menü kaldırıldı': 'Menú eliminado',
  'Menü yazılamadı': 'No se pudo escribir el menú',
  '{dir} içine menü ve kısayollar yazıldı': 'Menú y atajos escritos en {dir}',
  '{dir} içinden menü ve kısayollar kaldırıldı': 'Menú y atajos eliminados de {dir}',
  'Notepad++ ayarları yazılamadı': 'No se pudieron escribir los ajustes de Notepad++',
  'Notepad++ kapandı; menü ve kısayollar yeniden yazılıyor': 'Notepad++ se cerró; se vuelven a escribir el menú y los atajos',
  'Tanınmayan tuş: {key} ({text})': 'Tecla no reconocida: {key} ({text})',
  'Kısayolda tek bir tuş olmalı: {text}': 'Un atajo necesita exactamente una tecla: {text}',
  'Harf ve rakamlar en az bir değiştirici tuş ister (Ctrl, Alt, Shift): {text}': 'Las letras y los dígitos necesitan al menos una tecla modificadora (Ctrl, Alt, Shift): {text}',
  'Notepad++ dosyası tanınmadı: </NotepadPlus> yok': 'Archivo de Notepad++ no reconocido: falta </NotepadPlus>',
  'Notepad++ dosyası tanınmadı: </{tag}> yok': 'Archivo de Notepad++ no reconocido: falta </{tag}>',
  'Kısayol tanımı menüde olmayan bir girdiye bağlı: {id} (geçerli olanlar: {ids})': 'Atajo para una entrada que no está en el menú: {id} (válidas: {ids})',
  '{text} iki girdiye atanmış ({a}, {b}); yalnızca ilki kullanıldı': '{text} está asignado a dos entradas ({a}, {b}); solo se usó la primera',
  '{text} Notepad++ içinde başka bir komutta da tanımlı: {other}': '{text} también lo usa otro comando de Notepad++: {other}',
  '{label}: komut {n} karakter, Notepad++ en çok {max} kabul ediyor; girdi eklenmedi': '{label}: el comando tiene {n} caracteres y Notepad++ acepta como máximo {max}; entrada omitida',
  'Notepad++ {version} çok eski; en az 8.4.8 gerekiyor': 'Notepad++ {version} es demasiado antiguo; se necesita la 8.4.8 o posterior',
  'shortcuts.xml imzalanamadı; Notepad++ içinde Çalıştır > Validate shortcuts.xml komutunu bir kez kullanın': 'No se pudo firmar shortcuts.xml; ejecuta una vez Ejecutar > Validate shortcuts.xml en Notepad++',

  // Settings: right-click menus
  'Sağ tık menüleri': 'Menús del clic derecho',
  'Explorer ve Notepad++ içinden tek tıkla gönderim': 'Envío con un clic desde Explorer y Notepad++',
  'Bu özellik yalnızca masaüstü uygulamasında kullanılabilir.': 'Esta función solo está disponible en la aplicación de escritorio.',
  'Dosya ve klasörlere sağ tıklayınca “SamSync”: tümüne, son ayarla, profile, gruba ya da makineye tek tıkla gönder; incele ve gönder; yedekten geri al.':
    'Al hacer clic derecho en archivos y carpetas aparece “SamSync”: con un clic se envía a todos, con los últimos ajustes, a un perfil, a un grupo o a un equipo; revisar y enviar; restaurar desde una copia de seguridad.',
  'Makineler menüde': 'Equipos en el menú',
  'Alt menüsüyle: {groups}': 'Con submenú: {groups}',
  'Tek girdi (bütün gruba gönderir): {groups}': 'Una sola entrada (envía a todo el grupo): {groups}',
  '100 öğeye kadar seçim desteklenir; Explorer her öğe için uygulamayı bir kez başlatır, hepsi tek gönderimde toplanır. Windows 11’de “Daha fazla seçenek göster” altında görünür.':
    'Se admiten selecciones de hasta 100 elementos; Explorer inicia la aplicación una vez por elemento y todo se une en un solo envío. En Windows 11 aparece en “Mostrar más opciones”.',
  'Sekmeye sağ tıklayınca “SamSync” klasörü, Çalıştır menüsünde aynı komutlar ve kısayollar (Ctrl+Alt+W: son ayarla gönder).':
    'Una carpeta “SamSync” al hacer clic derecho en una pestaña, los mismos comandos en el menú Ejecutar y atajos (Ctrl+Alt+W: enviar con los últimos ajustes).',
  'Bu bilgisayarda Notepad++ bulunamadı.': 'No se encontró Notepad++ en este equipo.',
  taşınabilir: 'portátil',
  açık: 'abierto',
  'Notepad++ açıkken değişti; kapanırken kendi ayarlarını geri yazar. Notepad++ kapanınca SamSync menüyü ve kısayolları yeniden yazar.':
    'Cambiado mientras Notepad++ estaba abierto; este reescribe sus propios ajustes al cerrarse. Cuando Notepad++ se cierre, SamSync volverá a escribir el menú y los atajos.',
  Sığdıkça: 'Mientras quepan',
  'Windows menüsünde 16 girdiye kadar: önce bu makinenin grubu, sonra sığarsa diğer gruplar alt menüyle':
    'Hasta 16 entradas en el menú de Windows: primero el grupo de este equipo y, si caben, los demás grupos con submenú',
  'Her zaman': 'Siempre',
  'Bütün grupları alt menüsüyle göster': 'Mostrar todos los grupos con su submenú',
  'Yalnızca gruplar': 'Solo grupos',
  'Gruplar tek girdi olarak bütün gruba gönderir; tek tek makineler yok': 'Cada grupo es una sola entrada que envía a todo el grupo; no hay equipos individuales',
  'Notepad++ kısayolları': 'Atajos de Notepad++',
  'Kısayol ekle': 'Añadir atajo',
  'Ctrl, Alt, Shift ile bir tuş: harf, rakam, F1–F24, Insert, Delete, Home, End, PageUp, PageDown, yön tuşları. Paylaşılan yapılandırmaya yazılır, bütün makinelerde geçerlidir.':
    'Ctrl, Alt, Shift con una tecla: una letra, un dígito, F1–F24, Insert, Delete, Home, End, PageUp, PageDown o una tecla de flecha. Se guarda en la configuración compartida, así que vale para todos los equipos.',
  'Menüden gelen öğeler:': 'Elementos del menú:',
  'Ayna kipi hedeflerde toplam {n} öğe silecek. Gönderim sürsün mü?': pl('El modo espejo eliminará {n} elemento en los destinos. ¿Continuar con el envío?', 'El modo espejo eliminará {n} elementos en total en los destinos. ¿Continuar con el envío?'),
  'Rapor yazılamadı': 'No se pudo escribir el informe',
  'Hedefe erişilemiyor': 'Destino inaccesible',

  // updates
  'Bu kaynakta henüz yayımlanmış bir sürüm yok.': 'Todavía no se ha publicado ninguna versión en este origen.',
  'Bilinmeyen hata': 'Error desconocido',

  // one-click sends
  'Son ayar': 'Últimos ajustes',
  'Profil: {name}': 'Perfil: {name}',
  'Son gönderim ayarı yok': 'Aún no hay ajustes del último envío',
  'Önce bir kez “İncele ve gönder” ile gönderin; sonra aynı hedefler ve seçenekler tek tıkla kullanılır.': 'Envía primero una vez con “Revisar y enviar”; después, los mismos destinos y opciones se usan con un solo clic.',
  'Gönderim hedefte silme yapacak': 'Este envío eliminará elementos en los destinos',
  '{n} öğe silinecek; göndermeden önce gözden geçirin.': pl('Se eliminará {n} elemento; revísalo antes de enviar.', 'Se eliminarán {n} elementos; revísalos antes de enviar.'),
  'Masaüstü bildirimi bu sistemde desteklenmiyor': 'Las notificaciones de escritorio no se admiten en este sistema',
  'Masaüstü bildirimi gösterilemedi: {error}': 'No se pudo mostrar la notificación de escritorio: {error}',
  'Ekran görüntüsü': 'Captura de pantalla',
  'Alınamadı ({attempt}/{max}): {error}': 'No se pudo tomar ({attempt}/{max}): {error}',
};

export default d;
