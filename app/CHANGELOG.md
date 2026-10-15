# Sürüm Geçmişi

## 2.0.0 — SamSync

Eski PowerShell aracının (1.x) yerine, sıfırdan yazılmış çapraz platform masaüstü uygulaması (Electron + React + TypeScript).

- **Gönder** — sürükle-bırak, dosya/klasör seçimi ya da yol yapıştırma; gruplu hedef seçici (arama, erişim noktası, profiller, “son çalıştırmada hatalılar”). Gönderimden önce her hedef için dosya dosya plan: yeni / güncellenecek / hedef daha yeni / fazla; satır bazında dahil etme, kaynak–hedef satır farkı, seçimi tüm hedeflere uygulama. Kipler: üzerine yaz, yalnızca yeni, ayna. Karşılaştırma: tarih+boyut, içerik, boyut.
- **Git** — yerel değişiklikler (hazırlanmış, hazırlanmamış, izlenmeyen) ya da seçilen commit'ler (tek, çoklu, aralık; son commit, son 3, push edilmemişler). Commit'lerin dosyaları birleşik listede, her dosyanın farkı yanında. İçerik diskten ya da commit'ten; silinen/taşınan dosyalar hedeften de kalkar; commit içeriği git nesne özetiyle karşılaştırılır.
- **Senkron** — klasör çiftleri: iki yönlü (son durumu hatırlayarak silmeleri ve çakışmaları ayırır), ayna, güncelle, özel. Filtreler, sürümleme, işlem ızgarasında satır bazında değiştirme, uzak klasör tarayıcı.
- **Otomasyon** — canlı izleme (değişince yalnızca değişenleri gönderir, erişilemeyen makinelere dakikada bir yeniden dener) ve zamanlanmış senkron (aralıkla ya da belirli saatlerde, tek bir makinede). Hepsini duraklatma, sistem tepsisinde çalışmaya devam etme, oturum açılınca gizli başlama.
- **Yedekler** — hedeflerdeki yedek sürümlerini (`_SamSyncYedek`) bulma ve geri yazma.
- **Geçmiş** — hedef bazında sonuçlar, hatalar, günlük, CSV rapor, yeniden gönderme.
- Atomik yazma (geçici dosya + yeniden adlandırma), isteğe bağlı içerik doğrulaması, yeniden deneme, eşzamanlı hedefler ve dosyalar, hedef başına bant genişliği sınırı, iptal, kopyalama sonrası komut, eski yedeklerin temizlenmesi.
- Hedef türleri: SMB paylaşımı, klasör/bağlı sürücü, SFTP.
- Eski `config.json` doğrudan okunur, kaydederken eski aracın alanları korunur; makine tanıma kuralları aynıdır (ortam değişkeni `SAMSYNC_NODE_ID`).
- Explorer sağ tık menüsü (100 öğeye kadar, tek pencerede toplanır), komut satırı (`--to group:...`), komut paleti (`Ctrl+K`).
- Otomatik güncelleme: GitHub Releases, web adresi ya da ağ klasörü. GitHub Actions ile Windows, macOS ve Linux paketleri.
- Koyu (varsayılan), açık ve sistemle eşlenen tema; vurgu rengi; sıkı yoğunluk.
