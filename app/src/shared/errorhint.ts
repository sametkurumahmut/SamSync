// What an error a copy ran into most likely means, in a sentence with what to do about it: the messages come from
// Node, Windows, SMB and SFTP and say little to someone who does not know their codes.
import { t } from './i18n';

interface Hint {
  test: RegExp;
  text: () => string;
}

// the order matters: the first that matches wins (a "permission denied" while opening a missing share is the share)
const HINTS: Hint[] = [
  {
    test: /logon failure|unknown user name or bad password|\b1326\b|multiple connections to a server|\b1219\b/i,
    text: () => t('Paylaşıma bu kullanıcıyla bağlanılamadı: makineye Explorer’da bir kez bağlanıp kimliği kaydedin; aynı makineye farklı kullanıcılarla açık bağlantı varsa kapatın.'),
  },
  {
    test: /all configured authentication methods failed|authentication failed|permission denied \(publickey/i,
    text: () => t('SFTP oturumu açılamadı: kullanıcı adını, anahtarı ya da parolayı makineyi düzenleyerek denetleyin.'),
  },
  {
    test: /ENOSPC|no space left|not enough space|disk is full|disk dolu/i,
    text: () => t('Hedef diskte yer kalmadı: yer açın; Ayarlar › Kopyalama › Boş alan alt sınırı inceleme sırasında önceden uyarır.'),
  },
  {
    test: /EBUSY|resource busy|being used by another process|sharing violation|locked a portion|kullanımda|in use/i, // i18n-ignore: also SamSync's own messages in Turkish
    text: () => t('Dosyayı hedefte bir program kullanıyor: programı kapatıp yeniden deneyin; çalıştırma penceresindeki “Kapat ve tekrar dene” tutan programları gösterir.'),
  },
  {
    test: /ENAMETOOLONG|path too long|name too long|filename or extension is too long/i,
    text: () => t('Yol çok uzun: hedefteki tam yol Windows sınırını aşıyor; hedef kök klasörünü ya da klasör adlarını kısaltın.'),
  },
  {
    test: /filename, directory name, or volume label syntax is incorrect|invalid (file ?name|characters)/i,
    text: () => t('Dosya adı hedefte geçersiz: adında : * ? " < > | gibi karakterler ya da sonda nokta veya boşluk olabilir.'),
  },
  {
    test: /EROFS|read-only file system|write.protected/i,
    text: () => t('Hedef disk salt okunur: yazılabilir bir klasör seçin ya da diskin korumasını kaldırın.'),
  },
  {
    test: /semaphore timeout|EIO\b|i\/o error|specified network name is no longer available|network connection was aborted/i,
    text: () => t('Ağ bağlantısı yarıda koptu (çoğu zaman zayıf kablosuz bağlantıda olur): yeniden deneyin; Ayarlar › Kopyalama’daki bant sınırı bağlantıyı rahatlatabilir.'),
  },
  {
    test: /ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ECONNREFUSED|ECONNRESET|network path was not found|bad netpath|erişilemedi|unreachable/i, // i18n-ignore: also SamSync's own messages in Turkish
    text: () => t('Makineye ulaşılamadı: açık ve aynı ağda olduğunu denetleyin; Ayarlar › Genel › açılınca gönder seçeneği gönderimi makine gelene kadar bekletir.'),
  },
  {
    test: /EACCES|EPERM|permission denied|access is denied|erişim reddedildi|operation not permitted/i, // i18n-ignore: also SamSync's own messages in Turkish
    text: () => t('Yazma izni yok: paylaşımda bu kullanıcıya yazma izni verin; dosya salt okunursa ya da bir program tarafından korunuyorsa kaldırın.'),
  },
  {
    test: /EMFILE|ENFILE|too many open files/i,
    text: () => t('Aynı anda çok fazla dosya açık: Ayarlar › Kopyalama’da eşzamanlı dosya sayısını düşürün.'),
  },
  {
    test: /ENOENT|no such file or directory|cannot find the path|cannot find the file|bulunamadı|not found/i, // i18n-ignore: also SamSync's own messages in Turkish
    text: () => t('Dosya ya da klasör bulunamadı: kaynak taşındıysa listeye yeniden ekleyin; hedefse paylaşım adını ve kök klasörünü makineyi düzenleyerek denetleyin.'),
  },
];

/** A short explanation of an error with what to do, or null when it is not one of the usual ones. */
export function errorHint(message: string | undefined | null): string | null {
  if (!message) return null;
  for (const h of HINTS) if (h.test.test(message)) return h.text();
  return null;
}

/** The explanations for a list of errors, each with how many errors it covers, most first. */
export function errorHints(messages: (string | undefined)[]): { hint: string; count: number }[] {
  const by = new Map<string, number>();
  for (const m of messages) {
    const h = errorHint(m);
    if (h) by.set(h, (by.get(h) ?? 0) + 1);
  }
  return [...by.entries()].map(([hint, count]) => ({ hint, count })).sort((a, b) => b.count - a.count);
}
