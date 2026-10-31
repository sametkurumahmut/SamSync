# Sürüm Geçmişi

[English](CHANGELOG.md)

## Yayımlanmamış

- **Ekip bildirimleri:** Ayarlar › Bildirimler'de web kancası ve Telegram için ayrı açma-kapama anahtarları var; kanal kapatılınca adresi saklanır. **Hangi işler bildirsin**, Gönder, Git, Senkron, Otomasyon ve Geri alma arasından seçer; varsayılanda yalnızca Gönder sayfasından başlatılan gönderimler kanala gider. Gönder › Seçenekler › **Ekibe bildir** tek bir gönderimi, listeye özel seçeneklerle de bütün bir listeyi kapatır, örneğin kendi klasörleriniz için. Bölüm iletilerin ne zaman gittiğini de yazıyor: bir iş bitince, istenirse Gönder ve Git gönderimleri başlarken, sapma bulununca ve haftalık özette; iptal edilen ve deneme çalıştırmaları hiç gitmez.
- **Düzeltme (Git):** kökü bir Git deposu olan makinede Git sayfası, SamSync'in oradaki kendi dosyalarını (ajanın `_SamSyncRelay` klasörü, kilit ve manifest dosyaları, yazılmakta olan kopyalar) artık yerel değişiklik olarak listelemiyor; yerel değişiklikler gönderilirken bunlar da gitmiyor.
- **Yenilikler kartı:** sürüm notlarındaki girintili maddeler artık ayrı madde olarak değil, başlıklarının altında görünüyor.
- **Yardım:** üç yeni soru: SamSync'i telefondan ya da tabletten kullanmak, hedefteki `.samsync-tmp` dosyaları ve bir sürümde neyin değiştiğinin nereden görüleceği.
- **Web sitesi:** Git ekran görüntüsü projenin kendi çalışma ağacından değil, küçük bir demo deposundan alınıyor; ekran görüntüleri yeniden çekildi.

## 2.4.13 — 2026-10-27

- **Telefon ve tablet:** web arayüzü telefonda ve dik tutulan tablette (820 piksel ve altı) sığıyor. Kenar çubuğu simge şeridi olarak kalıyor, üst çubuk sadeleşiyor, sayfalar tek sütuna geçiyor ve başlığıyla birlikte bütün olarak kayıyor. Gönder sayfasının alt çubuğu ekranın altında yapışık ve küçük; Git, Karşılaştır, Senkron, Hedefler ve Geçmiş'te hiçbir şey yana taşmıyor.
- **Geçici dosyalar:** kopan bir bağlantının hedefte bıraktığı SamSync geçici dosyaları (`*.samsync-tmp`) o klasörü tarayan bir sonraki gönderimin sonunda siliniyor: bir günden eski olanlar, büyük dosyaların yarım parçaları da 14 gün sonra. Bu dosyalar karşılaştırmada ve incelemede artık fazla dosya olarak görünmüyor. Ayna kipi, büyük bir dosyanın kaldığı yerden sürecek parçasını da artık fazla dosya sanıp silmiyor.
- **Düzeltme:** Ayarlar'da uzun bir klasör yolu açıklama satırında kırılıyor, kartı genişletmiyor.

## 2.4.12 — 2026-10-27

- **Görünüm düzeltmeleri:**
  - Gönder sayfasında seçenekler alttaki çubuğun arkasına kayıyordu; sütunlar artık kendi içinde kayıyor, çubuk hep üstte.
  - Genel bakış'ta *Bugün* kartının grafiği alt satırın üstüne taşmıyor.
  - Üst çubuktaki komut arama kutusu geniş pencerede her sayfada ortada duruyor.
  - Senkron'da klasör çifti satırı kartı dolduruyor, uzun yollar "…" ile kısalıyor, makine seçicinin oku kesilmiyor.
  - Hedefler'de arama kutusu ve *Durum* düğmesi araç çubuğunun öteki düğmeleriyle aynı boyda. Kartlardaki satırlar yan yana hizalı: henüz gönderim yapılmamış makinenin kartında *Henüz gönderim yok* yazıyor, bağlantı satırı yukarı kaymıyor.
  - Git'te fark görünümünün yatay kaydırma çubuğu son satırı örtmüyor.
  - Gönder'deki *Eşzamanlı hedef* ve Senkron'daki *Saklanacak sürüm* kutuları satırlarıyla hizalı.
  - Karşılaştır'da düğme seçicilerle aynı boyda; boş Kaynaklar kartının ipucu kenara yapışmıyor.
  - Ayarlar › Hakkında'da veri klasörü Windows'ta ters bölüyle yazıyor; *Geliştirici araçları* artık bir düğme.
  - Yardım'da arama simgesi kutunun içinde. Kapalı düğmeler daha okunur.
- **Düzeltme:** sürüm noktasında "Bu noktaya dön…", sonraki bir gönderim noktada olmayan makinelere de gittiyse onu o makinelerde de geri alıyordu; artık yalnızca noktanın makinelerinde geri alıyor.
- **Düzeltme:** hedefteki manifest klasör adının büyük/küçük harfine bakıyordu: `Bin` diye yazılan bir klasör `bin` diye gönderilince manifest kullanılmıyor, ikisi ayrı kayıt olarak kalıyordu. Artık aynı klasör sayılıyor.

## 2.4.11 — 2026-10-26

- **Onay pencereleri:** ayna kipinin silme uyarısı ve öteki bütün "emin misiniz?" soruları artık tarayıcının hazır kutusu yerine SamSync'in kendi penceresinde çıkıyor. Silme, üzerine yazma ya da kapatma gibi işlerde onay düğmesi kırmızı ve odak *Vazgeç*'te; yanlışlıkla Enter'a basmak bir şey silmiyor.

## 2.4.10 — 2026-10-23

- **Makinenin grubu:** çalıştırma penceresinde ve Geçmiş'teki çalıştırma ayrıntısında her makinenin adının başında, varsa grubunun adı küçük bir etiket olarak yazıyor.

## 2.4.9 — 2026-10-23

- **Hata açıklamaları:** çalıştırma penceresinde ve Geçmiş'te hatalı makinenin altında hatanın olası nedeni ve ne yapılacağı yazıyor (yazma izni yok, disk dolu, dosya kullanımda, ağ koptu, yol çok uzun, makineye ulaşılamadı…); Geçmiş › Hatalar sekmesinin üstünde nedenler sayılarıyla.
- **HTML rapor:** Geçmiş'te bir çalıştırma, makineleri, hataları ve olası nedenleriyle tek bir sayfa olarak kaydediliyor (paylaşmak ya da yazdırmak için).
- **Günlükte arama:** çalıştırma penceresinde ve Geçmiş'te günlükte ve hatalarda arama.
- **Çalıştırma notu:** Geçmiş'te bir çalıştırmaya not eklenebiliyor; başlığın altında ve listede görünüyor, aramada bulunuyor.
- **Filtre denemesi:** Gönder › Filtreler › **Neyi dışarıda bırakıyor?** kaynakları şimdiki filtrelerle gezip dışarıda kalan her dosya ve klasörü, onu dışlayan desenle gösteriyor.
- **Hedeflerde durum süzgeci:** Hedefler sayfasında yalnızca erişilemeyen, meşgul, son gönderimi hatalı, devre dışı ya da SamSync çalışmayan makineler gösterilebiliyor.
- **Hâlâ yazılan kaynak:** gönderilecek dosyalardan biri son 10 saniyede değiştiyse inceleme uyarıyor.
- **Başlayınca da bildir:** Ayarlar › Bildirimler › *Gönderim başlayınca da bildir* (varsayılan kapalı): ne gönderildiği, hangi makinelere ve kimin gönderdiği gönderim başlarken de kanala gidiyor.
- **Bant sınırı saatleri:** Ayarlar › Kopyalama › *Bant sınırı saatleri* (örneğin 08:00-18:00; boş = her zaman): sınır yalnızca bu saatlerde başlayan gönderimlerde geçerli.
- **İptaller kanala gitmiyor:** iptal edilen bir gönderim Telegram'a ve web kancasına bildirilmiyor; çalıştırma penceresi ve Geçmiş yine gösteriyor.
- **Güvenlik (web arayüzü):** izleyici girişi artık dosya içeriği okuyamıyor, başkalarının işini iptal edemiyor ve bildirim kanalının anahtarlarını görmüyor. Git sürüm adlarıyla git'e seçenek geçirilemiyor. Aynı anda gelen parola denemeleri de sayılıyor ve uygulamayı yavaşlatmıyor. Ana parola izleyici parolasıyla aynı olamıyor.
- **Düzeltme (veri kaybı):** ayna kipi ve senkron, fazla bir klasörü silerken filtrenin dışarıda bıraktığı dosyaları da siliyordu. Artık klasörün içindekiler tek tek gidiyor, klasör yalnızca boşalınca kaldırılıyor.
- **Düzeltme (veri kaybı):** iki yönlü senkron, sağ taraf bulunamadığında (çıkarılmış bir disk) sol taraftaki her şeyi siliyordu; artık o çift çalışmıyor. Okunamayan bir klasörün altında senkron da gönderim de bir şey yapmıyor.
- **Düzeltme (veri kaybı):** yedek almayan bir makinede **Geri al**, gönderimin güncellediği dosyaları siliyordu; artık yalnızca gönderimin eklediği dosyalar kaldırılıyor. Birkaç gönderimi geri alırken eski yedekler budanmıyor; dosyanın yerine klasör konduysa dosya geri geliyor.
- **Düzeltme:** hedefteki manifest başka bir filtreyle yazıldıysa güvenilmiyor; geri alma, senkron ya da yarıda kalan bir gönderimden sonra eskiyen manifest siliniyor.
- **Düzeltme:** yarıda kalan büyük bir dosya, kaynağı arada değiştiyse eski parçanın üstüne devam ettirilmiyor.
- **Düzeltme (otomasyon):** *Kaçırılanları yetiştir* kapalıyken saatli zamanlamalar hiç çalışmıyordu; açıkken de uygulama kapalıyken kaçan saat yetiştirilmiyordu. Bozulan klasör izlemesi yarım dakikada bir yeniden kuruluyor; sürekli değişen bir dosya gönderimi sonsuza dek ertelemiyor; iptal edilen *Sonra gönder* çalışmıyor; aynı zamanlanmış iş iki kez koşmuyor; kısalan git geçmişi eski commit'leri yeniden göndermiyor.
- **Düzeltme:** rölenin arkasındaki makineler hatalı bitince hem gönderen hem röle yeniden deniyordu. Paket yüklenirken bir kaynak dosya kaybolunca uygulama çökebiliyordu. Uzun bir duraklatma röle işini zaman aşımına uğratıyordu.
- **Düzeltme:** CSV içe aktarma dosyada olmayan sütunları boş sayıyordu; Excel'in Türkçe kaydettiği dosyalarda harfler bozuluyordu. Kaldırılan etiket, MAC ve röle işareti yapılandırma dosyasından geri gelmiyor.
- **Düzeltme:** kısa pencerede (web arayüzünde de) Gönder sayfasındaki boş Kaynaklar kartı **Dosya seç** ve **Klasör seç** düğmelerini ve yol kutusunu kesiyordu. Kart artık sığdığı yüksekliğe göre sıkışıyor: önce büyük simge, sonra açıklama satırı kalkıyor, düğmeler hep görünüyor.

## 2.4.8 — 2026-10-22

- **Bildirimde hedefler:** gönderim bitince ekip kanalına (Telegram, web kancası) giden iletide makinelerin nereye gittiği yazıyor. Grubun tamamına gittiyse grup adı ve sayısı (`Lab-A (4)`), bir kısmına gittiyse grup adı ve o makineler (`Lab-B: PC-1, PC-2`), grubu olmayan makineler tek tek. Web kancasının JSON'unda her makinenin grubu da var.

## 2.4.7 — 2026-10-22

- **Meşgul bilgisi olmayan makineler:** SamSync çalışmayan makinede kimse meşgul olup olmadığını bildirmiyor; noktası yeşil kalsa da kartta, hedef seçicide ve ağ görünümünde noktanın üstüne gelince *Meşgul bilgisi yok: bu makinede SamSync çalışmıyor* yazıyor. Ağa ek yük getirmiyor.
- **Düzeltme:** SamSync çalışan makineye (röle ya da ajan) gönderimde **Duraklat** ve **İptal et** paket yazılırken bir şey yapmıyordu; yavaş bağlantıda zamanın çoğu bu adımda geçtiği için düğmeler çalışmıyor gibi görünüyordu. Artık iptal yüklemeyi hemen durduruyor (hedefte yarım paket kalmıyor), duraklat yüklemeyi bekletiyor. İş makineye geçtiyse ikisi de oradaki SamSync'e iletiliyor: röle grubuna dağıtımı durduruyor ve o ana kadar ne yaptığını bildiriyor (bunun için o makinede de bu sürüm olmalı). İptale basınca düğme *İptal ediliyor…* olarak kalıyor ve günlüğe bir satır düşüyor.

## 2.4.6 — 2026-10-22

- **Hatalı makineleri yeniden dene:** Ayarlar › Kopyalama › *Hatalı makineleri yeniden dene (dk)* (varsayılan 0 = kapalı) ve *En çok yeniden deneme* (varsayılan 3). Gönderimin hatalı ya da kısmen bittiği makinelere o kadar dakika sonra kendiliğinden yeniden gönderiliyor; her deneme Otomasyon sayfasında "(yeniden deneme 1/3)" adıyla bekliyor ve iptal edilebiliyor.
- **Son görülme:** erişilemeyen makinenin kartında ve hedef seçicide en son ne zaman yanıt verdiği görünüyor (*son görülme 3 saat önce*); bilgi yeniden başlatmada korunuyor.
- **Toplu işlemler:** Hedefler sayfasında **Seç** ile kartlar ya da bütün bir grup işaretleniyor. Alttaki çubuktan seçilenler birlikte uyandırılıyor, yeniden başlatılıyor ya da kapatılıyor (izin verenler), ajanları güncelleniyor, etkinleştiriliyor ya da devre dışı bırakılıyor, etiket ekleniyor ya da kaldırılıyor, başka gruba taşınıyor.
- **Makine listesi CSV:** Hedefler › Yapılandırma'da **CSV olarak dışa aktar…** ve **CSV’den içe aktar…**. İçe aktarma kaydetmeden önce yeni ve değişen makineleri gösteriyor; dosyada olmayan makineler olduğu gibi kalıyor.
- **Haftalık özet:** Ayarlar › Bildirimler › *Haftalık özet* (varsayılan kapalı). Her pazartesi 09:00'da (bilgisayar kapalıysa ilk açılışta) ekip kanalına son yedi günün gönderimleri, veri miktarı, en çok hata veren makineler, şu an erişilemeyenler ve sapma bulunan makineler gidiyor; **Özeti şimdi gönder** ile hemen.
- **Boş alan alt sınırı:** Ayarlar › Kopyalama › *Boş alan alt sınırı (GB)* (varsayılan 2, 0 = kapalı). Altında kalan hedef kırmızı görünüyor; gönderimden sonra daha azı kalacaksa inceleme uyarıyor.
- **Düzeltme:** "Bu sürümde yeni" penceresinde ve yardımda *italik* yazılar yıldızlarıyla görünüyordu.

## 2.4.5 — 2026-10-22

- **Meşgul makineler:** SamSync çalışan makine dakikada bir hedef klasörün içinden çalışan programlara (ve Ayarlar › Ajan'daki listede olanlara) bakıyor. Varsa makinenin noktası sarı, yanında **meşgul** rozeti: kartta, hedef seçicide, ağ görünümünde ve incelemede. Üstüne gelince programlar, tıklayınca hedef klasörde açık tuttukları dosyalar listeleniyor. İsteyen makine *Meşgulken gönderimi beklet* ile gönderimi program kapanana kadar bekletebiliyor (varsayılan kapalı).
- **Sonra gönder:** incelemede **Sonra gönder…** ile gönderim bir tarih ve saate kuruluyor; istenirse kapalı makineler beş dakika önce uyandırılıyor. O saatte kaynaklar yeniden karşılaştırılıyor. Bekleyenler Otomasyon sayfasında, iptal edilebiliyor.
- **Gönderim sırası:** Ayarlar › Kopyalama › *Aynı makinelere giden gönderimler sırayla gitsin* (varsayılan kapalı): başka bir gönderimin yazdığı makinelere giden gönderim onun bitmesini bekliyor.
- **Etiketler:** makinelere gruptan bağımsız birden çok etiket verilebiliyor; hedef seçicinin *Seç* menüsünde etikete göre seçim, profillerde ve komut satırında `tag:<ad>`.
- **Uzaktan yeniden başlat ve kapat:** izin veren makinenin (Ayarlar › Ajan, varsayılan kapalı) kartındaki menüden ya da *Gönderimden sonra* seçeneğiyle; makinede bir dakikalık uyarı çıkıyor, iptal edilebiliyor.
- **Buradan dağıt:** SamSync çalışan bir makinenin kartından, o makinedeki klasörler öbür makinelere onun ağı üzerinden gönderiliyor; bu bilgisayarın bağlantısından bir şey geçmiyor.
- **Makine geçmişi:** karttaki geçmiş düğmesi o makineye ulaşan bütün çalıştırmaları sonuç, sürüm noktası ve denetimiyle gün gün listeliyor; satır Geçmiş'te açılıyor.

## 2.4.4 — 2026-10-21

- **Aşamalı gönderim:** incelemede **Aşamalı gönder** ile önce seçilen makinelere gidiyor; onlar sorunsuz biterse (varsa sağlık denetimi de evet derse) ötekiler kendiliğinden ya da çalıştırma penceresindeki **Kalanlara gönder** onayıyla gidiyor. İlk makinelerden biri hatalıysa gönderim duruyor; **Yine de kalanlara gönder** ya da **Vazgeç**. Her aşama Geçmiş'te ayrı bir çalıştırma.
- **Sağlık denetimi:** ajanın "Uyguladıktan sonra komut"u ve bu bilgisayarın "Kopyalama sonrası komut"u nasıl bittiyse (kod ve son satırlar) çalıştırma penceresinde ve Geçmiş'te makine satırında **denetim** rozeti olarak görünüyor. İsteyen için başarısız komut makineyi hatalı sayıyor: Ayarlar › Ajan ve Ayarlar › Kopyalama'da birer anahtar (varsayılan kapalı).
- **Röle devralma:** Ayarlar › Kopyalama › *Röle kapalıysa gruptan başka bir makine röle olsun* (varsayılan kapalı). Rölesinde SamSync çalışmayan gruba gönderimde, grupta SamSync çalışan ilk makine o gönderim için röle oluyor; dosyalar yavaş bağlantıdan yine bir kez geçiyor.
- **Hazırla, sonra tek seferde değiştir:** gönderim seçeneği. Dosyalar hedefte önce geçici adla yazılıyor, hepsi gelip hiçbiri kullanımda değilse bir anda yerlerine konuyor; program yarım sürüm görmüyor. Bir dosya gelmezse canlı klasöre hiç dokunulmuyor.
- **Anlık sapma:** Ayarlar › Ajan › *Gönderilen klasörleri izle* (varsayılan kapalı). Gönderilen klasörlerde elle yapılan değişiklik birkaç saniye içinde makine kartında **sapma n** olarak görünüyor; SamSync'in kendi gönderimleri sayılmıyor.
- **Sürüm farkı:** Geçmiş'te sürüm noktasında **Farkı göster…**: o noktadan başka bir sürüm noktasına ya da son gönderime kadar makinelerde eklenen, değişen ve silinen dosyalar; CSV ya da HTML rapor olarak kaydedilebiliyor.
- **Makine değişkenli dosyalar:** Ayarlar › Kopyalama › *Makine değişkenli dosyalar* (örneğin `*.ini`, varsayılan boş = kapalı). Uyan UTF-8 metin dosyalarında `{{machine.id}}`, `{{machine.name}}`, `{{machine.title}}`, `{{machine.address}}`, `{{machine.group}}` her makine için dolduruluyor; tek dosya bütün makinelere yetiyor.
- **Düzeltme:** röle üzerinden gönderim alan makinelere makineye özel klasördeki dosyalar gitmiyordu; röle artık bu dosyaları, kendi sürümüyle tuttuğu ortak dosyaları ve değişkenli dosyaların ham hâlini kenarda tutup her makineye kendininkini gönderiyor.
- **Düzeltme:** `.samsync-pack` dosyasından SamSync çalışan bir makineye gönderim, paket içindeki dosyalar ajanın paketine konamadığı için hata veriyordu.

## 2.4.3 — 2026-10-21

- **Ajan durumu kartta:** kalp atışı artık SamSync sürümünü, paylaşımın gösterdiği klasörü, son işi ve son hatayı da taşıyor. Makine kartında **ajan 2.4.2** (bu kopyadan eskiyse sarı, *eski*), oradaki SamSync haber vermeden yanıt vermez olduysa **ajan durmuş**, son hata için bir uyarı işareti. Makinenin kendisinde "Bu makine" kartı ve Ayarlar › Ajan, ilk yerel kök yoksa ya da paylaşım başka bir klasörü gösteriyorsa (rölede ya da gönderenlerin zaten yazdığı yerde) uyarıyor; **Düzelt** paylaşımın klasörünü ilk yerel kök yapıyor.
- **Ajanları ağdan güncelleme:** Hedefler sayfasında **Ajanları güncelle (n)** ve kartta bir ok: bu sürümün Windows kurulumu makinenin paylaşımına bırakılıyor, oradaki SamSync dosyayı SHA-512 ile denetleyip çalışan iş kalmayınca sessizce kuruyor ve yeniden açılıyor. Kurulum bu bilgisayarın sakladığı kopyadan, güncelleme klasöründen ya da sürüm sayfasından (bir kez indirilir) geliyor; hiçbiri yoksa dosya seçilebiliyor. Röle, grubundaki makinelere kendi ağları üzerinden iletiyor. Alan makinede Ayarlar › Ajan › *Ağdan güncellemeyi kabul et* gerekiyor (varsayılan kapalı).
- **Dosyayı tutan programlar:** kullanımdaki dosyalarla biten bir gönderimde çalıştırma penceresi, her makinede dosyaları hangi programların tuttuğunu işlem numaraları ve dosyalarıyla gösteriyor (bu makinede doğrudan, ötekilerde oradaki SamSync üzerinden). **Kapat ve tekrar dene** onları kapatıp dosyaları yeniden yazıyor; başka makinede orada Ayarlar › Ajan › *Gönderenler dosyayı tutan programı kapatabilsin* gerekiyor (varsayılan kapalı). Sistem programları ve Explorer kapatılmıyor.
- **Makineye özel dosyalar:** Ayarlar › Kopyalama › *Makineye özel klasör* (örneğin `_machines`, varsayılan boş = kapalı). Gönderilen klasörün en üstündeki bu klasörde makine kimliği, adı, adresi ya da grup adıyla adlandırılmış alt klasörler yalnızca o makinelere, ortak dosyaların üstüne gidiyor; klasörün kendisi gönderilmiyor. İnceleme bu dosyaları *bu makineye özel* diye işaretliyor, ayna kipi onları silmiyor, paket klasörü olduğu gibi taşıyor.
- **Sapma denetimi:** Makine envanterinde **Sapma denetle**: her makinede son gönderimden sonra değişen, eklenen ve silinen dosyalar, makinenin manifestine göre. SamSync çalışan makine kendi diskine bakıyor. Saatte bir, 6 saatte bir ya da günde bir kendiliğinden de çalışabiliyor (varsayılan kapalı); bulduğunu masaüstüne ve ekip kanalına bildiriyor.
- **Uyandırma (Wake-on-LAN):** kapalı makinenin kartında **Uyandır**, grupta **Kapalıları uyandır**. MAC adresi makine açıkken kendiliğinden öğreniliyor (SamSync'in kalp atışından ya da ARP tablosundan) ya da makine düzenleyicisine yazılıyor.
- **Hata olursa makineyi geri al:** gönderim seçeneklerinde (varsayılan kapalı). Bir makinede gönderim yarıda kalırsa o makine yedekten gönderim öncesi hâline dönüyor; yedek bunun için kendiliğinden açılıyor, geri alma Geçmiş'te ayrı bir çalıştırma.
- **Düzeltme:** paketi kendisi uygulayan makinelerde Geçmiş'teki **Geri al**, gönderimin değiştirdiği dosyaları yedekten geri getirmek yerine siliyordu; ajan artık hangi dosyaları yedeklediğini bildiriyor, geri alma doğru çalışıyor.

## 2.4.2 — 2026-10-21

- **Listeye özel seçenekler:** Gönder sayfasındaki seçenekler kartında **Genel / Bu listeye özel**. Özel seçilince seçenekler o sekmede kalıyor (sekmede küçük bir simge), liste hızlı gönderim olarak kaydedilince onunla saklanıyor; genel seçenekler değişmiyor. **Genel seçeneklere göre sıfırla** ve **Varsayılanlara sıfırla** düğmeleri. Komut satırından açılan hızlı gönderim ya da profil artık genel seçenekleri değiştirmiyor, kendi sekmesinde kendi seçenekleriyle açılıyor.
- **Yollar ve ipuçları:** makine kartında adın üstüne gelince ad, adres, kimlik ve grup görünüyor (kırpılan kimlik de); yola tıklayınca Explorer'da açılıyor, sağ tıkta "Explorer'da göster" ve "Yolu kopyala". Otomasyon kartlarındaki yollar da aynı; hedef satırının üstüne gelince bütün makineler alt alta.
- **Bildirimler tek sefer:** röle ya da ajan bir gönderim için yaptığı işi (paketi uygulama, gruba dağıtma) artık ekip kanalına ayrıca bildirmiyor; bütün gönderim bitince gönderen taraf her makineyle birlikte bir kez bildiriyor. Rölenin kuyruktan sonradan yaptığı teslimi yine röle bildiriyor.
- **Gönderen:** Telegram ve web kancası bildiriminde gönderenin hesabı `whoami` biçiminde yazıyor (`ALAN\kullanıcı`, yerel hesap değilse makine adıyla); web kancasının JSON'unda `user` alanı.

## 2.4.1 — 2026-10-21

- **Karşılaştır sayfası da hedefteki özetleri kullanıyor:** içeriğe göre karşılaştırmada Karşılaştır sayfası, `--check-only`, makine ↔ makine karşılaştırması ve senkron işleri de SamSync çalışan makineden dosyaların özetini istiyor; dosyalar ağ üzerinden okunmuyor. Makine ↔ makine karşılaştırmasında yalnızca bir tarafta SamSync çalışıyorsa yalnızca öbür taraf okunuyor. Kaç dosyanın orada özetlendiği sekmede ve sayaçların yanında görünüyor.

## 2.4.0 — 2026-10-21

- **Ajan, her makinede:** SamSync çalışan her makine kendisine gönderileni sıkıştırılmış tek paket olarak alıp kendisi uyguluyor; eskiden bu yalnızca rölelerde vardı. Ayarlar › Ajan (varsayılan açık): uygulamadan önce komut (dosyaları tutan programı durdurmak için; başarısız olursa hiçbir şeye dokunulmaz), uyguladıktan sonra komut, varış bildirimi. Makine kartı ve incelemede **ajan** rozeti. Klasör (`_SamSyncRelay`) ilk yerel kökte durur, Windows'ta gizlidir, hiçbir gönderime girmez, ajan kapatılınca silinir.
- **Hedefte içerik karşılaştırması:** içeriğe göre karşılaştırmada ajan olan makinenin dosyaları ağ üzerinden geri okunmuyor; o makine dosyaların SHA-256 özetini kendi diskinde hesaplayıp yazıyor, burada kendi kopyalarınızın özetiyle karşılaştırılıyor. İncelemede "N özet orada" rozeti. Yanıt vermeyen makine eskisi gibi ağdan okunur.
- **Blok farkı:** ajanın diskinde zaten bulunan 8 MB ve üstü dosyalarda yalnızca değişen 1 MB'lık bloklar gidiyor; makine dosyayı kurup bütün dosyanın özetini denetlemeden yerine yazmıyor.
- **Erişilemeyen makineye açılınca gönder:** Ayarlar › Genel (varsayılan kapalı). Kapalı makineye yapılan gönderim bu bilgisayarda bekliyor, makine açılınca kaynakların o anki hali gidiyor; 7 gün içinde açılmazsa düşüyor. Bekleyenler Hedefler sayfasında.
- **Web arayüzü için HTTPS:** Ayarlar › Web arayüzü (varsayılan kapalı). Bilgisayar kendi sertifikasını üretiyor; doğrulama için parmak izi gösteriliyor, oturum çerezi yalnızca şifreli bağlantıda gidiyor.
- **Komut satırından paket:** `--pack <klasör>` pencere açmadan paket yazıyor; `--since <paket|makine>` artımlı paket.
- **Kullanımdaki dosyalar:** Ayarlar › Genel › *Çalıştırma sonunda kullanımdaki dosyaları bir kez daha dene* (varsayılan kapalı). Böyle hatalarla biten çalıştırmanın panelinde **Kullanımdakileri tekrar dene**: yalnızca o dosyalar, inceleme olmadan, aynı makinelere.
- **Makine kartı:** son gönderim bir sürüm noktasıysa son gönderim satırında adı görünüyor.
- **Ayarlar düzeni:** kartlar birbirine yakın biten sütunlara diziliyor, kısa kartlar üstte; satır satır hizalamanın bıraktığı boşluklar ve aşırı uzun sayfa gitti.
- **Geçmiş, dar pencere:** çalıştırmanın düğmeleri başlığın altına iniyor, liste çalıştırmanın üstünde duruyor ve sayfa kayıyor.
- **Düzeltme:** aynı ayar dosyasına aynı anda iki yazma (örneğin bir gönderimin hatırlanan hedefleri ve bir ayar değişikliği) ikincisinin "dosya bulunamadı" hatasıyla düşmesine yol açabiliyordu; yazmalar artık sırayla yapılıyor.

## 2.3.0 — 2026-10-20

- **Hızlı karşılaştırma:** ağ paylaşımındaki klasörler artık işletim sisteminin klasör sorgusuyla listeleniyor; bir klasörün bütün dosyaları boyut ve tarihle tek seferde geliyor, dört klasör aynı anda soruluyor. Eskiden her dosya için ayrı bir sorgu gidiyordu ve on binlerce dosyalık bir karşılaştırma Wi-Fi'da dakikalar sürüyordu. Dışlanan klasörler yine atlanıyor; yerel klasörler düz gezintiyle kalıyor.
- **Kopyalama öncesi komut:** Ayarlar › Kopyalama. Her hedefe ilk dosya gitmeden önce bu bilgisayarda çalışır, sonrası komutla aynı yer tutucuları alır; sıfırdan farklı kodla biterse o makineye yazılmaz. Gönder sayfasında gönderim başına açılıp kapatılır. Hedefteki programı durdurup (sonrası komutla) yeniden başlatmak için.
- **Kullanımda uyarısı:** inceleme, değişecek dosyaların hedefte açık tutulup tutulmadığını önceden deniyor (en büyük 150 dosya) ve makine başlığında adlarıyla uyarıyor; satırda da not düşüyor.
- **Kapsam notu:** kaynaklar hedefte iç içe gidince ya da aynı yere gidince satırın altında ne olacağı yazıyor: "Contents/ hariç: orayı başka bir kaynak alıyor", "X ile aynı yere gidiyor; içerikleri birleştirilir".
- **Artımlı paket:** Paket yaz penceresinde "Önceki pakete göre" ya da "Makinedeki sürüme göre". Orada olduğu gibi duran dosyalar pakete yalnızca liste olarak girer; alan makinedeki inceleme eksik ya da farklı çıkanları söyler.
- **Sürüm noktası:** Geçmiş'te bir gönderimi adlandırın; "Bu noktaya dön…" o makinelere sonradan giden gönderimleri en yenisinden başlayarak yedeklerinden geri alır, yedeksiz olanları atlayıp belirtir.
- **Dosya izi:** Geçmiş'te bir dosya adıyla hangi gönderimle hangi makineye gittiğini bulma, en yenisi üstte; tıklayınca çalıştırma açılır.
- **Boş alan:** erişilebilen makinenin diskindeki boş alan Hedefler sayfasında ve hedef listesinde (2 GB altında kırmızı).
- **İzleyici parolası:** Ayarlar › Web arayüzü'nde ikinci bir parola; onunla giren tarayıcı her şeyi görür, hiçbir şeyi değiştiremez; başlık çubuğunda "salt okunur". Ana paroladan farklı olmalı.

## 2.2.6 — 2026-10-20

- **Güncelleme penceresi:** indirilen sürüm artık sistemin düz iletişim kutusu yerine uygulamanın kendi penceresinde sunuluyor: sürüm rozeti, yayın tarihi, şu anki sürüm, sürüm notları ve süren bir gönderim varsa uyarı (kurulum uygulamayı yeniden başlatır; gönderim sürerken kurma düğmesi kapalı). **Daha sonra** ve **Şimdi kur ve yeniden başlat**. Başlık çubuğundaki düğme ve Ayarlar › Güncelleme aynı pencereyi açar.
- **Geliştirme:** `SAMSYNC_SCREENSHOT` ile alınan pencere görüntüsü ilk denemede alınamazsa (sanal ekranda derleyici henüz kare üretmemişse) birkaç kez daha denenir ve alınamazsa uygulama yine kapanır; duman testi beklemek yerine eksik görüntüyü bildirir.

## 2.2.5 — 2026-10-20

- **Kullanımdaki dosya, aynı içerik:** hedefte bir programın açık tuttuğu dosya değiştirilemediğinde SamSync artık içeriğini kaynakla karşılaştırıyor; aynıysa yalnızca tarihini eşitliyor ve öğeyi hata değil tamamlanmış sayıyor. Tarihleri korumayan bir araçla kopyalanmış dosyalar eskiden her gönderimde "dosya kullanımda" hatası veriyordu; bir kez tarih eşitlenince bir daha seçilmiyor.
- **Yeniden dene:** iptal edilen ya da hatalı biten çalıştırmanın panelinde **Yeniden dene**: aynı kaynaklar iptalden sonra bütün makinelere (zaten gitmiş olanlar atlanır), hatadan sonra yalnızca hatalı makinelere yeniden planlanır; önce inceleme açılır.
- **Görev çubuğu ilerlemesi:** inceleme hazırlanırken ve karşılaştırırken de görev çubuğundaki düğme ilerliyor; hedefteki klasörler listelenirken bekleme çubuğu olarak dönüyor.
- **Bitince ses:** gönderim bitince kısa bir ses: başarılıysa yükselen iki nota, hata varsa alçak bir uyarı. Ayarlar › Genel: her bitişte (varsayılan), yalnızca hata varsa ya da kapalı; iki sesi dinleme düğmeleri. Deneme çalıştırmaları ve iptaller sessizdir.
- **Bildirimler:** masaüstü bildirimi gösterilemediğinde (Windows tam ekran bir program ya da odak yardımı yüzünden tutuyorsa) nedeni günlüğe yazılıyor.

## 2.2.4 — 2026-10-20

- **Düzeltme:** Git sayfasındaki hedef seçicide **Seç** menüsünün komutları (görünenlerin tümünü seç, seçimi temizle, erişilebilirleri seç, profiller…) çalışmıyordu: menüye tıklamak, seçicinin açılır penceresini dışarı tıklama sayıp kapatıyordu. Aynı durum oradaki sağ tık menüsü için de geçerliydi. Bir açılır pencerenin içinden açılan menü artık dışarı sayılmıyor; dışarı tıklama pencereyi yine kapatıyor.

## 2.2.3 — 2026-10-19

- **Her kaynağın hedefteki yeri:** yer listesi artık yalnızca kök dışı kaynaklarda değil, her kaynakta var: yerel köke göre yol (varsayılan), üstteki klasörlerin hedef kökü sayıldığı yerler, tam yol ve hedef köküne göre elle yazılan bir yol (**Başka bir yol yaz…**, örneğin `Contents`).
- **Çakışan kaynaklar:** aynı yere giden iki klasörün içerikleri birleştiriliyor (eskiden ikincisi sessizce atlanıyordu); ikisinde de olan dosya listede önce gelenden alınıyor ve inceleme bunu bildiriyor. Başka bir kaynağın yerinin içine düşen, başka bir yerden gelen kaynak hedeflerin o kısmını devralıyor: `Release` köke, başka bir diskteki `Contents` de `Contents`'e gidiyorsa `Release` hedefteki `Contents`'e hiç dokunmuyor, ayna kipinde de orada silmiyor.
- **Kaynak listesi:** tıklama, Ctrl ve Shift ile çoklu seçim (Ctrl+A hepsi); seçilenleri etkinleştir, devre dışı bırak ya da çıkar. Devre dışı kaynak listede kalıyor ama gönderilmiyor, karşılaştırılmıyor, pakete yazılmıyor, izlenmiyor. Sağ tık: **Explorer’da göster**, **Yolu kopyala**, etkinleştir/devre dışı bırak, **Listeden çıkar**. Liste doluyken de altta **Dosya seç**, **Klasör seç** ve yol yapıştırma kutusu duruyor. Büyük bir klasör sayılırken satırı "Okunuyor" yazıyor; yeni eklenen kaynak, öncekileri yeniden saymadan okunuyor.
- **Hedef listesinde sağ tık:** **Explorer’da göster** gönderimin o makinede vardığı klasörü (paylaşımı ya da bu makinenin kendi kökünü) açıyor; **Yolu kopyala** ve **Yalnızca bunu seç**.
- **Düzeltme:** inceleme penceresindeki makine satırları pencereye ulaşmıyordu; artık listeleme, karşılaştırma ve okunan içerik görünüyor, hedefteki klasörler listelenirken çubuk bekleme çubuğu olarak dönüyor.

## 2.2.2 — 2026-10-19

- **İnceleme ilerlemesi:** inceleme hazırlanırken pencere her makine için bir satır gösteriyor: sırada, erişim deneniyor, hedefteki klasörler listeleniyor, "8.400 / 20.013 dosya karşılaştırıldı • 1,2 GB içerik okundu" ya da bitti. Üstteki çubuk makine sayısı yerine karşılaştırılan dosyalara göre ilerliyor; eskiden bütün makineler bitene dek boş kalıyordu.
- **Bu makineye gönderme:** kaynakların hepsi bu makinenin yerel köklerinin dışındaysa (başka bir diskteki sürüm gibi) gönderen makine de hedef listesinde çıkıyor; eskiden yalnızca paket dosyalarında çıkıyordu. Dosyalar paylaşım yerine doğrudan ilk yerel köke, kendi diskine yazılıyor. Hedef listesi bu makine için paylaşım yolu yerine yerel kökü, inceleme de **bu makine** rozetini gösteriyor. Kendi kökünden ya da o kökü içine alan bir klasörden gönderirken bu makine yine listede yok.
- **Tam yol ipucu:** hedef listesinde, incelemede ve çalıştırma panelinde kırpılarak görünen hedef yolunun tamamı üzerine gelince ipucu olarak görünüyor.

## 2.2.1 — 2026-10-19

- **Kök dışı kaynaklar:** hiçbir yerel kökün altında olmayan bir klasör artık hedefte sürücü harfiyle tam yoluna (`C/…/Release/…`) gitmiyor; kendi klasörü hedef kökünün yerine geçiyor, yani içindekiler doğrudan hedef köküne yazılıyor. Bir dosya da hedef köküne adıyla gidiyor. Gönder sayfasında kaynağın altındaki listeden başka bir yer seçilebilir: üstündeki her klasör hedef kökü olabilir ya da eski tam yol korunabilir. **Yerel kök yap** seçili klasörü bu makinenin yerel köklerine ekler. Seçim sekmede, hızlı gönderimde, izlemede ve geçmişteki **Yeniden gönder**de saklanıyor; Karşılaştır sayfası ve paket yazma da aynı yeri kullanıyor. Ayarlar › Kopyalama › **Kök dışı kaynakları tam yoluyla gönder** eski davranışı varsayılan yapar.
- **Düzeltme:** güncellemeden sonra görev çubuğunda SamSync yerine Electron simgesi görünebiliyordu. Geliştirme ve test çalıştırmaları kurulu uygulamayla aynı Windows uygulama kimliğini kullanıyordu; Electron bildirim için bu kimlikle bir Başlat menüsü kısayolu açınca Windows kurulu uygulamayı o kısayola bağlıyordu. Geliştirme çalıştırmaları artık kendi kimliğini kullanıyor.
- **Düzeltme:** web arayüzündeki oturum kapatma düğmesi İngilizce arayüzde "Quit" yazıyordu; artık **Oturumu kapat** / **Sign out**.
- **Belgeler:** İngilizce README ve proje sitesi artık arayüzü İngilizce etiketleriyle anlatıyor.
- **Lisans:** SamSync artık **GNU Genel Kamu Lisansı sürüm 3 (GPL-3.0)** ile dağıtılıyor (telif © 2026 Samet Kurumahmut). Lisans metni deponun kökünde ve her pakette (`LICENSE`) duruyor, Windows kurulumunun ilk sayfasında gösteriliyor; Ayarlar › Hakkında, SSS, README'ler, proje sitesi ve winget bildirimi lisansı belirtiyor.
- **Erişilebilirlik:** Geçmiş sayfasının listeleri küçük pencerede klavyeyle kaydırılabiliyor; devre dışı ayar satırları ekran okuyucuya devre dışı olarak bildiriliyor. Uçtan uca test erişilebilirlik taramasını uygulamanın en küçük pencere boyutunda da yapıyor.

## 2.2.0 — 2026-10-18

- **Web arayüzü (sunucu kipi):** Ayarlar › **Web arayüzü** açılınca hep açık duran bilgisayardaki SamSync penceresini ağdaki tarayıcılara sunar; diğer makinelere kurulum gerekmez. Giriş parolayla (bu bilgisayarda yalnızca scrypt özeti saklanır), oturum HttpOnly/SameSite çerezle; beş yanlış denemeden sonra o adres bir dakika bekler; API çağrıları özel bir başlık ister. Tarayıcıda dosya seçimi sunucunun disklerini gezen bir pencereyle yapılır; bu bilgisayarın masaüstüne dokunan işlemler (pencere, dosya açma, güncelleme kurma, sunucunun kendi ayarı) tarayıcıdan yapılamaz. Ağdan erişim ya da yalnızca bu bilgisayar, kapı seçimi, bağlı tarayıcı sayısı, adres listesi. Bağlantı HTTP'dir: güvenilen ağ ya da TLS ekleyen ters vekil.
- **Kurulum sihirbazı ve ağ tarama:** ilk açılışta üç adım — bu makine (ad, adres, gönderdiği klasör, paylaşım kökü), ağda bulunan makineler (bu bilgisayarın alt ağları dosya paylaşımı 445 ve SSH 22 kapılarından denenir; ad, Windows'ta paylaşım listesi, zaten tanımlı olanlar işaretli), gözden geçir ve kaydet. Hedefler sayfasında **Ağı tara**: bulunan makine tek tıkla düzenleyiciye dolu gelir.
- **Bildirim merkezi:** başlık çubuğundaki zil; biten gönderimler (hatalı olanlar okunmamış kalır), erişilemez olan ya da geri gelen makineler, yeni sürüm, duran izleme, hatalı biten zamanlanmış iş. Gün gün gruplu, tıklayınca ilgili sayfayı (geçmişte o çalıştırmayı) açar; son 100 olay saklanır.
- **Çalıştırmayı duraklat:** çalıştırma panelinde **Duraklat / Sürdür** (dosyalar arasında bekler, süren kopya da akış ortasında durur) ve her hedefin satırında **çıkar** — o makinenin kalan işlemleri atlanır, diğerleri sürer.
- **Çakışma çözücü:** iki yönlü senkronda **n çakışmayı çöz…** penceresi: her çakışma için iki tarafın boyutu ve tarihi, nedeni, farkı; sol, sağ, **ikisini de sakla** ya da atla; toplu olarak "yeni olan kazansın", "sol kazansın", "sağ kazansın", "ikisini de sakla". İkisini de sakla her tarafa öbürünün sürümünü `ad (sol).uzantı` / `ad (sağ).uzantı` olarak yazar, hiçbir şey silinmez; iş, iki taraftan biri değişene dek o dosyaya dokunmaz.
- **Röleye teslimat kuyruğu:** röle, gönderim anında kapalı olan makinenin işini `_SamSyncRelay/pending` altında saklar ve açılınca teslim eder (Ayarlar › Kopyalama: yeniden deneme aralığı, en çok kaç gün). Çalıştırma panelinde ve geçmişte "kuyrukta" rozeti; rölenin kartında kuyruktaki makineler, iş sayısı ve son deneme.
- **Parolalı paket ve çift tık:** **Paket yaz** isteğe bağlı parolayla AES-256 şifreli paket yazar (içerik ve dizin okunamaz; anahtar scrypt ile türetilir). Uygulayan makinede Gönder listesinde "parolalı" rozeti ve **Parola…** düğmesi; bir kez girilen parola uygulama kapanana dek hatırlanır. `.samsync-pack` dosyaları kurulumla SamSync'e bağlanır: çift tık paketi Gönder sayfasına getirir.
- **Manifeste güven:** Ayarlar › Kopyalama › **Manifeste güven (gün)**; 0 her gönderimde tam tarama demektir. Gönder sayfasında **Hedefi baştan tara** seçeneği ve incelemede manifestten gelen hedefin yanında **Tam tara**.
- **Görünüm:** makine adları her yerde aynı biçimde — kısa ad üstte, adres altta küçük harfle (ağ görünümünde kartlar kutuyu dolduracak kadar genişler); hedef kartlarında son 48 yoklamanın gecikme grafiği (yanıt yoksa kırmızı çizgi); geçmişte gün ayraçları ve Bugün / 7 gün / 30 gün süzgeci; boş sayfalarda çizimler ve örnekler; sayfa yüklenirken iskelet; başlık çubuğunda **Bot** etiketi ve güncelleme indiyse **Yeniden başlat ve güncelle**.
- **Erişilebilirlik:** klavyeyle gezinmede her yerde odak halkası; "hareketi azalt" ayarına uyan animasyonlar; adsız düğmeler, onay kutuları, anahtarlar, seçim kutuları ve renk örnekleri ekran okuyucuya adlarını söylüyor; alan etiketleri kutularına bağlı; soluk metin her iki temada 4,5:1 kontrastta. Uçtan uca testteki axe-core taramasında beş ana sayfada kritik ve ciddi ihlal yok.
- **Diller:** Almanca ve İspanyolca eklendi (Ayarlar › Görünüm › Dil; "Sistemle eşle" bilgisayarın dilini izler). Yardım içeriği bu dillerde İngilizce gösterilir.
- **Düzeltme:** Hedefler sayfasında yeni hedefin önerilen paylaşım kökü `Share\Release` yerine `ShareRelease` yazılıyordu.
- **Geliştirme ve dağıtım:** ESLint (hata ve erişilebilirlik kuralları) ve Playwright ile uçtan uca test (`npm run e2e`: gönder, karşılaştır, geri al, axe-core) CI'da; yayınlara `SHA256SUMS.txt` eklenir; `npm run winget` yayımlanmış kurulumun winget bildirimini üretir; `npm run site` README'ler, SSS ve ekran görüntülerinden proje sitesini kurar (GitHub Pages iş akışı, depo değişkeniyle açılır).

## 2.1.1 — 2026-10-17

- **Düzeltme:** veri klasörü (`SAMSYNC_USER_DATA`, taşınabilir sürümün yanındaki `SamSync-data`) tek-örnek kilidinden önce seçiliyor; eskiden kurulu uygulama açıkken başlatılan taşınabilir kopya ya da ekran görüntüsü/duman testi çalıştırması kendini ikinci örnek sanıp pencere açmadan kapanıyordu.
- **Genel adlar:** SSS, yardım botu, yer tutucular, belgeler ve demo artık herhangi bir kuruma özgü ad taşımıyor; örnekler `Lab-A`, `PC-1`, `NAS`, `ShareRelease` gibi genel adlarla yazıldı; ekran görüntüleri yenilendi.
- **Düzeltme:** yardım botu ve çalıştırma paneli çekmeceleri başlık çubuğunun altından başlıyor; Windows'ta pencerenin küçült/büyüt/kapat düğmeleri çekmecenin kendi düğmelerini örtüyordu.

## 2.1.0 — 2026-10-17

- **Yardım botu ve SSS:** başlık çubuğundaki bot düğmesi ya da **F1** bir sohbet çekmecesi açar; "nasıl gönderirim", "röle nedir", "sürümü USB ile götüreceğim" gibi soruları yanıtlar, yanıtın geldiği SSS maddesini ya da README bölümünü gösterir ve ilgili sayfayı açar. Çevrimdışı çalışır: 40 maddelik iki dilli SSS ve uygulamayla gelen README üzerinde Türkçe/İngilizce gövde bulma ve eş anlamlı sözlüğüyle arama. Ayarlar › **Yardım botu**'na bir Claude API anahtarı girilirse (bu makinede şifreli saklanır) serbest sorular belgelerle birlikte Claude'a gider; anahtar yokken ya da hata olursa çevrimdışı yanıt gösterilir. Yeni **Yardım** sayfası: arama kutusu, konu konu açılır SSS, README'den eşleşen bölümler. Komut paletinde *Yardım botuna sor…*.
- **Genel bakış sayfası (Ctrl 1):** uygulama artık bu sayfayla açılıyor. Üstte kutular: makineler (erişilen/toplam, erişilemeyenlerin adı), bugün aktarılan veri ve 14 günlük küçük grafik, son 7 günün hatalı gönderimleri, otomasyon (izleme ve zamanlanmış iş sayısı, duraklatıldıysa), envanter (geride/eksik), varsa röle ve güncelleme. Altta son gönderimler, hızlı gönderimler, izlemeler ve zamanlanmış işler.
- **Ağ görünümü:** genel bakışta bu bilgisayar solda, gruplar sağda birer kutu; her gruba giden çizgi erişilebilirliğe göre renkli (hepsi yeşil, bir kısmı sarı, hiçbiri kırmızı kesikli), röle işaretli ve dağıttığı makinelere kesikli çizgiler. Makineye tıklamak onu gönderim hedefi yapar / çıkarır; bir makineyi başka bir grubun kutusuna sürüklemek grubunu değiştirir (sorarak, yapılandırmaya yazar).
- **Paket dosyası (.samsync-pack):** Gönder sayfasında **Paket yaz** kaynakları makineler yerine tek bir sıkıştırılmış dosyaya yazar (gönderimin dışlamaları ve `.samsyncignore` uygulanır; rölenin paket biçimi + bir dizin). Diskle götürülen sürüm için: dosya hedef makinede SamSync'in Gönder listesine eklenince klasör gibi bir kaynak olur — plan içindekileri hedefle karşılaştırır, yalnızca farklı olanları yazar, ayna fazlalıkları siler, bitince manifest kalır; sonraki ağ gönderimi yine hızlı başlar. Bütün kaynaklar paketse **bu makine** de hedef seçilebilir (kendi diskine doğrudan yazar, röle sayılmaz). Kaynak satırında "paket" rozeti: etiket, dosya sayısı, boyut, kimden, ne zaman.
- **Makine envanteri:** Hedefler sayfasında tablo — satırlar gönderilen klasörler, sütunlar makineler, hücrede o makinedeki sürümün etiketi, zamanı ve boyutu (manifestten). Bir klasörün en yeni hâli ölçüt: ondan eski olanlar "geride" (sarı, saat simgesi), hiç gönderilmemiş olanlar "eksik", erişilemeyen makine kırmızı başlık. Her bitişten sonra kendini yeniler; **Yenile** düğmesi var. Genel bakıştaki Envanter kutusu da buradan beslenir.
- **Yarım kalan büyük dosyaya devam:** 8 MB ve üstü dosyalar hedefte sabit adlı geçici dosyaya yazılır; iptal, kopan bağlantı ya da kapanan uygulama yüzünden yarım kalan dosya bir sonraki gönderimde kaldığı bayttan sürer (önce hedefteki parçanın son 256 KB'ı kaynakla karşılaştırılır; tutmazsa baştan). Günlükte "kaldığı yerden sürüyor (412 MB / 1,2 GB)". **İptal artık dosyanın bitmesini beklemiyor:** akış anında kesilir, parça kalır. 14 günden eski parça silinir.
- **Çalıştırma paneli:** son 60 saniyenin hız grafiği (anlık, tepe, ortalama; 5 sn sıfırsa "bekliyor"), gruplar için "Lab-A 3/5" çipleri. Windows görev çubuğundaki simgede gönderim ilerlemesi dolar; pencere odakta değilken biten gönderim simgeyi yanıp söndürür.
- **Geçmiş:** üstte istatistik şeridi — son 30 günün gönderim sayısı, aktarılan veri ve ortalama hız, hatalı sayısı/yüzdesi, gün gün çubuk grafik (hatalı gün kırmızı; çubuğa tıklayınca liste o güne süzülür), en çok veri alan makineler. **Geri al** düğmesi: yedek alarak yapılmış bir gönderimin değiştirdiği ve sildiği dosyaları o gönderimin yedeklerinden geri getirir, eklediği dosyaları siler (şimdiki hâller de yedeklenir); yedeksiz gönderimde çıkmaz.
- **Karşılaştır: makine ↔ makine.** Kaynak yerine iki makine seçilir (A, B) ve bir klasör: yalnız birinde olanlar, farklı olanlar, hangisinin daha yeni olduğu; dosyaya tıklayınca iki makinedeki hâlinin satır farkı. aynı olması gereken makineler (A ↔ B) arasındaki sapmayı yakalar; hiçbir şey yazılmaz.
- **Zamanlanmış hızlı gönderim:** kaydedilmiş bir gönderim belirli saatlerde ya da her n dakikada bir kendi kendine gider (bu makinede, inceleme açılmadan; değişiklik yoksa bir şey yapmaz). Çipteki kalem ad, kısayol ve zamanlamayı düzenler; Otomasyon sayfasındaki zamanlanmış işler arasında "hızlı gönderim" rozetiyle listelenir, **Şimdi çalıştır** var.
- **Bildirimler (Ayarlar):** gönderim bitince bir web kancasına JSON (durum, etiket, makineler, işlem/bayt sayıları, süre, özet metin) ve/veya Telegram botuyla bir sohbete mesaj; hatalı/kısmi bitişlerde her zaman, başarılılarda isteğe bağlı; başarısız makineler nedenleriyle listelenir; **Sına** düğmesi. Deneme çalıştırmaları bildirilmez.
- **Hata ekranı:** arayüz çökerse boş pencere yerine hatanın metni, **Yeniden yükle**, **Tanı klasörü oluştur** ve **Hatayı kopyala** düğmeleri; yakalanmayan hatalar bir uyarı balonu ve günlük satırı olur (tanı klasörüne girer). Tanı klasörü artık o oturumun günlük satırlarını da içerir.
- **Pencere ve ölçek:** pencerenin boyutu, yeri ve ekranı kaplama durumu bir sonraki açılışta geri gelir (ekran bağlı değilse ortada açılır). **Arayüz ölçeği** %70–175: Ctrl + / Ctrl − / Ctrl 0 ya da Ayarlar › Görünüm; başlık çubuğu düğmeleri de ölçeklenir.
- **Kısayollar:** Ctrl / tüm kısayolların listesi; Ctrl , Ayarlar; Ctrl Enter Gönder sayfasında inceleme açar, incelemede gönderir (Shift ile deneme); Ctrl 1…9 sayfalar (Genel bakış 1). Komut paletindeki ipuçları sayfa sırasını izler.
- **Bu sürümde yeni kartı:** güncellemeden sonraki ilk açılışta o sürümün CHANGELOG bölümü bir kez gösterilir (dosya uygulamayla birlikte gelir); Ayarlar › Hakkında ve komut paletinden yeniden açılır.
- **Hız:** içerik karşılaştırması özetleri (yer, yol, boyut, zaman) `hashcache.json`'da hatırlar; içerikle karşılaştırılan bir gönderim büyük dosyaları kopyalarken özetini de alır, sonraki içerik karşılaştırması o dosyayı ağdan okumaz. Genel bakış dışındaki sayfalar ilk açıldıklarında yüklenir (ilk paket 1,34 MB → 1,12 MB). Çalıştırma günlüğü anında `history/<id>.log` dosyasına akar; bellekte son 2000 satır kalır, geçmiş ayrıntısı dosyadan okur (50 bin satıra kadar).
- **Yayın akışı:** paketlenmiş uygulama her platformda bir kez açılıp penceresinin görüntüsü alınır; boş pencere (bozuk paket) yayını durdurur, görüntü artefakt olarak kalır. Yerelde `npm run smoke`. `scripts/bench-smb-compress.ps1` bir paylaşıma robocopy ile /COMPRESS'li ve /COMPRESS'siz kopya hızını ölçer (uzak makinelere erişim olmadığı için henüz ölçülmedi).

## 2.0.3 — 2026-10-17

- **Manifest ile hızlı karşılaştırma:** her gönderimden sonra hedefin kökünde `samsync-manifest.json` kalır (gönderilen klasörün altındaki her şey: ad, boyut, tarih; kim ne zaman yazdı). Sonraki gönderim hedefi ağ üzerinden klasör klasör gezmek yerine manifestten başlar — önce kökün listesi ve dosyalardan 24 örnek hedefle karşılaştırılır; biri bile tutmazsa (örneğin sürüm diskten kopyalandıysa) eski usul tam tarama yapılır. 7 günden eski manifest kullanılmaz. İncelemede "manifestten" rozeti; Karşılaştır sayfası her zaman doğrudan bakar. Röleye giden paket uygulanınca röle manifesti kendi diskinden yazar.
- **Aynı makineye iki kişi:** gönderim sürerken hedefin kökünde `samsync-lock.json` durur (bilgisayar adı, kullanıcı, gönderimin adı, başlangıç zamanı, sürüm). Başkasının taze kilidi varsa inceleme makine kartında "ahmet yazıyor" rozeti ve açıklaması çıkar, çalıştırma günlüğüne de uyarı düşer; gönderim yine devam eder. 30 dakikadan eski kilit yok sayılır; kilit bitince kaldırılır. Bu dosya ve `samsync-manifest.json` hiçbir zaman gönderilmez, karşılaştırılmaz, aynada silinmez.
- **İnceleme: klasör ağacı.** Gönderim planı artık klasör klasör görünüyor: her klasör satırında dalın sayıları (+yeni ~değişen !hedef daha yeni −silinecek), işlem sayısı ve boyutu; tek çocuklu klasör zincirleri tek satırda ("Models/Vehicle"); ilk düzey açık gelir, tümünü aç/kapat düğmeleri var; klasörün onay kutusu bütün dalı seçer ya da bırakır; arama yaparken eşleşenler hep görünür. Düz liste de duruyor, aradaki geçiş hatırlanıyor.

## 2.0.2 — 2026-10-17

- **Sıkıştırılmış paket:** röle olarak işaretlenen (SamSync çalışan) bir makineye dosyalar artık tek tek kopyalanmıyor; gönderimin değişiklikleri tek bir sıkıştırılmış paket olarak (`_SamSyncRelay\jobs\<id>.pack`, dosya başına gzip; zip/png/mp4 gibi zaten sıkışık olanlar olduğu gibi) yazılıyor, oradaki SamSync paketi kendi diskine uyguluyor (yedek, kullanımdaki dosya denetimi, doğrulama aynı), sonra grubundakilere dağıtıyor. Ağ üzerinden dosya başına birkaç tur yerine tek akış; bir DLL ~%40, PDB ~%23 boyuta iniyor. Grubunda kimse olmayan bir röle de paketi kendisi için alır. Çalıştırma günlüğünde "Paket: 6,5 MB → 2,6 MB (%40)". Makine yanıt vermezse paket geri alınır ve röle dahil hepsine doğrudan gönderilir.
- **Röle canlılığı:** röledeki SamSync paylaşıma yarım dakikada bir `_SamSyncRelay\alive.json` yazıyor. Hedefler sayfasında rozet "röle açık / röle kapalı" diyor; kalp atışı eski ya da yoksa plan o makineye ve arkasındakilere doğrudan yazıyor, 60 sn beklemiyor.
- **Hızlı gönderimler:** Gönder sayfasındaki listeyi (kaynaklar, hedefler, seçenekler) bir adla kaydet; sonra tek tıkla gönder — Gönder sayfasındaki şeritten, tepsi menüsündeki **Hızlı gönder**'den, komut paletinden, `SamSync.exe --quick "ad"` ile (kısayol ya da Görev Zamanlayıcı) ya da sistem geneli bir **kısayol tuşuyla** (örn. Ctrl+Alt+1; uygulama tepsideyken de çalışır). "Önce incele" açıksa inceleme açılır. Bu makineye özel (settings.json).
- **Ayarlar:** Güncellemeler bölümünde **Sürüm notları** düğmesi (GitHub'daki sürüm sayfası); Hakkında bölümünde **Tanılama klasörü oluştur…** — günlükler, yapılandırma, ayarlar ve bir özet (makine, erişim, röle, son çalıştırmalar) tek klasöre kopyalanır, parolalar hariç.
- **README:** `npm run screenshots` ekran görüntülerini demodan iki dilde kendisi alıyor; Hedefler sayfası galeriye eklendi.
- **Uyanık kal:** bir gönderim sürerken bilgisayar uykuya dalmıyor (ekran kapanabilir); Wi‑Fi üzerinden dakikalar süren PDB gönderimi yarıda kalmıyor.
- **Hız sınaması:** makine kartındaki göstergeyle 3 MB rastgele veri yazılıp geri okunur, silinir; yazma/okuma hızı ve gecikme kartta ve günlükte ("↑0,5 ↓2,1 MB/sn • 180 ms").
- **Röle durumu:** röle olan makinede "Bu makine" kartı rölenin durumunu gösterir: grup, alınan iş sayısı, son işin zamanı ve sonucu.
- **Hedefler:** her makine kartında son gönderimin hızı, süresi ve zamanı ("son gönderim: 1,5 MB/sn • 12 sn • 3 dk önce"); yavaş makine bir bakışta belli.
- **Plan:** pencerenin son 60 sn içinde erişilebilir gördüğü makineye plan sırasında yeniden erişim denetimi yapılmıyor (gönderim başına bir tur daha az).

## 2.0.1 — 2026-10-16

- **Röle (bir makine üzerinden dağıtım):** Hedefler'de bir makine **röle** olarak işaretlenince, onunla birlikte seçilen grup makinelerine dosyalar önce yalnızca ona gider (kendi, çoğu zaman yavaş, bağlantınızdan tek kopya); oradaki SamSync işi paylaşımdaki `_SamSyncRelay` klasöründen alıp dosyaları kendi diskinden grubun ağı üzerinden dağıtır ve sonucu yazar. İnceleme, çalıştırma paneli ve geçmiş her makineyi "X üzerinden" rozetiyle, röleden gelen sonucuyla gösterir. Röle 60 sn içinde işi almazsa (orada SamSync çalışmıyorsa) o makinelere buradan doğrudan ayrı bir gönderim başlar. Tek başına seçilen bir grup makinesi röleye uğramaz; Karşılaştır sayfası ve `--check-only` her makineye doğrudan bakar. `copy.relayAckSeconds` ve `copy.relayTimeoutMinutes` süreleri ayarlar.
- **Hız:** gönderim her dosya için hedefte 8 yerine 3 işlem yapıyor (kopyala, yeniden adlandır; Windows'ta değişiklik zamanı kopyayla geliyor); klasörler bir kez soruluyor; boş alan sorgusu karşılaştırmayla aynı anda yapılıyor. Varsayılan eşzamanlılık: 16 dosya, 8 hedef (en çok 64 / 32); Node dosya iş parçacığı havuzu 32. Yeni izlemelerin bekleme süresi 0,8 sn (en az 0,2 sn).
- **Sağ tık menüsü:** menü artık **SamSyncSend.exe** adlı küçük bir programı başlatıyor; o da komutu çalışan uygulamaya bir boru üzerinden birkaç milisaniyede veriyor (eskiden her tıklama ikinci bir Electron süreci açıyordu, ~1 sn). Uygulama kapalıysa SamSync.exe'yi başlatıyor. Kurulumla ve zip'le gelir; tek dosyalı taşınabilir sürüm kendisini başlatmaya devam eder. İkinci bir SamSync.exe de artık ağır modülleri yüklemeden çıkıyor.
- **Erişim denetimi:** pencere açıkken yapılan düzenli denetim Windows'ta paylaşımın kendisine de bakıyor: 445'e yanıt veren ama paylaşımı vermeyen makine "erişilemiyor" görünüyor ve SMB oturumu açık kalıyor, sonraki gönderim oturum kurmakla vakit kaybetmiyor.
- **Çalıştırma paneli:** gönderim sırasında hız (MB/sn) ve kalan süre; her hedefin yanında kendi hızı, bitince ortalaması. Günlüğe hedef başına boyut, süre ve hız yazılıyor.
- **Kullanımdaki dosya:** 1 MB ve üstü bir dosya hedefte değiştirilecekse önce hedefteki dosya yazma için açılıp deneniyor; bir program (ör. yüklü DLL) tutuyorsa dosya ağ üzerinden hiç taşınmadan, yeniden denemeden "dosya kullanımda… ya da yazma izni yok" hatası veriliyor. Yeniden adlandırmada da aynı açık mesaj (ham EPERM yerine).
- **Otomasyon:** izleme kartlarında **Şimdi gönder** düğmesi. İzlenen yollarda hedeften farklı olanları beklemeden gönderir, izleme kapalıyken de; senkron işi çalıştıran izlemede işi çalıştırır. Yalnızca farklar gider, hedefte bir şey silinmez.

## 2.0.0 — SamSync

Eski PowerShell aracının (1.x) yerine sıfırdan yazılmış, çapraz platform bir masaüstü uygulaması (Electron + React + TypeScript). Eski aracın menüleri, tek tıkla gönderimi ve sihirbaz özellikleri de içindedir.

- **Gönder** — sürükle-bırak, dosya/klasör seçimi ya da yol yapıştırma. Gruplu hedef seçicide arama, erişim noktası, profiller ve “son çalıştırmada hatalılar” var.
  - **Plan:** gönderimden önce her hedef için dosya dosya plan çıkar: yeni / güncellenecek / hedef daha yeni / fazla.
  - **İnceleme:** satır bazında dahil etme, kaynak–hedef satır farkı, seçimi tüm hedeflere uygulama.
  - **Kipler:** üzerine yaz, yalnızca yeni, ayna. Eski sihirbazdaki gibi her hedefe ayrı kip ve yedek ayarı verilebilir.
  - **Karşılaştırma:** tarih+boyut, içerik, boyut.
  - **Sekmeler:** her sekme kendi kaynaklarını ve hedeflerini tutar; sağ tık menüsünden gelen öğeler kendi sekmesinde açılır.
- **Karşılaştır** — Gönder sayfasındaki kaynakları hedeflerle hiçbir şey göndermeden karşılaştırır. Hedef başına yeni / değişen / hedefte daha yeni / fazla dosyalar süzgeç ve aramayla listelenir, seçilen dosyanın satır farkı yanında görünür.
- **Git** — yerel değişiklikler (hazırlanmış, hazırlanmamış, izlenmeyen) ya da seçilen commit'ler (tek, çoklu, aralık; son commit, son 3, push edilmemişler).
  - Commit'lerin dosyaları birleşik bir listede, her dosyanın farkı yanında gösterilir.
  - İçerik diskten ya da commit'ten alınır; silinen ve taşınan dosyalar hedeften de kalkar.
  - Commit içeriği git nesne özetiyle karşılaştırılır.
- **Senkron** — klasör çiftleri: iki yönlü (son durumu hatırlayarak silmeleri ve çakışmaları ayırır), ayna, güncelle, özel. Filtreler, sürümleme, işlem ızgarasında satır bazında değiştirme ve uzak klasör tarayıcı var.
  - **Yok sayma dosyası:** iki tarafın ya da gönderilen klasörün kökündeki `.samsyncignore` desenleri hariç tutulur.
  - **Silinenler:** sürüm klasörüne (sayıyla ve günle sınırlı), yerel klasörlerde Geri Dönüşüm Kutusu'na ya da kalıcı.
  - **İş dosyası:** bir iş `.samsync-job.json` olarak dışa aktarılır ve içe aktarılır.
  - `--sync <iş>` pencere açmadan çalıştırır (çıkış kodu 0 = başarılı).
- **Otomasyon** — canlı izleme ve zamanlanmış senkron.
  - **İzleme:** değişince yalnızca değişenleri gönderir, erişilemeyen makinelere dakikada bir yeniden dener.
  - **Zamanlanmış senkron:** aralıkla ya da belirli saatlerde, tek bir makinede çalışır.
  - Hepsi duraklatılabilir; uygulama sistem tepsisinde çalışmaya devam edebilir ve oturum açılınca gizli başlayabilir.
  - **Git olayları:** commit, amend, merge, pull (isteğe bağlı rebase, cherry-pick, reset) sonrası değişen dosyalar gönderilir; dal değiştirmek bir şey göndermez.
  - **Hedefler:** yapılandırmadaki makineler, yapılandırma gerektirmeyen düz klasörler ya da her değişiklikte çalışan bir senkron işi (canlı senkron).
  - **Ayarlar:** erişilemeyen makinelere yeniden deneme (varsayılan kapalı, aralığı ayarlanır), bildirim, tek gönderimdeki dosya sınırı, kaçırılan zamanlamaların açılışta çalışması.
- **Yedekler** — hedeflerdeki yedek sürümlerini (`_SamSyncYedek`) bulup geri yazar.
  - Explorer ve Notepad++ menüsünden gelen öğeleri bütün makinelerde arar.
  - Eski aracın yedek klasörleri de taranır. Hedef kökünde `_` ile başlayıp yalnızca `yyyyMMdd-HHmmss` klasörleri içeren klasör yedek klasörü sayılır ve ayna kipinde silinmez.
- **Geçmiş** — hedef bazında sonuçlar, hatalar, günlük, yeniden gönderme.
  - Her çalıştırmadan sonra bir CSV rapor kendiliğinden yazılır; son 300 rapor saklanır.
  - Kapalı olan makineler de hatalı sayılır.
- **Explorer menüsü** — kurulumla gelir ve varsayılan olarak açıktır. Eski aracın menüsüyle aynı yapıdadır:
  - tümüne gönder, incele ve gönder, son ayarla gönder, yedekten geri al;
  - profiller, gruplar ve makineler;
  - bölümler arasında ayırıcılar;
  - 16 girdi sınırına göre önce bu makinenin grubu açılır; davranış `menuShowNodes` ile değiştirilebilir.

  Uygulama her açılışta menüyü çalışan programa göre yeniden kurar; kaldırıcı menüyü siler.
- **Notepad++** — sekme sağ tık menüsünde bir “SamSync” klasörü, Çalıştır menüsünde aynı komutlar ve kısayollar (`notepadPlusPlusShortcuts`; varsayılan `Ctrl+Alt+W` = son ayarla gönder).
  - Notepad++ 8.9.6.2'nin istediği `shortcuts.xml` imzası `config.xml` içine yazılır.
  - Notepad++ açıkken değişen ayarlar, Notepad++ kapanınca yeniden yazılır.
  - 260 karakteri aşan komutlar uyarıyla atlanır.
- **Komut satırı**
  - `--to` hedefleri seçer: makine, `group:`, `profile:`, `all`, `last`.
  - `--yes` incelemeden hemen gönderir.
  - `--restore` Yedekler sayfasını öğelerle açar.
  - `--plan-only` ve `--check-only` pencere açmadan çalışır: plan ya da hedeflerin durumu standart çıktıya yazılır. Durumlar `Ayni` / `Farkli` / `Yok` / `Erisilemedi` / `Hata`; çıkış kodu 0 hepsinin aynı olduğunu gösterir.
  - Explorer'ın her öğe için başlattığı süreçler tek gönderimde birleşir.
- **Profiller** — hedeflerle birlikte gönderim seçeneklerini de saklar. Eski sihirbazın profilleri ve son ayarları Ayarlar → Yapılandırma dosyası → *Sihirbaz ayarlarını içe aktar* ile alınabilir.
- **Ayna kipi** — hedeflerde silinecek öğe varsa göndermeden önce toplam sayıyla ayrıca onay istenir. Tek tıkla gönderimde silme varsa doğrudan gönderilmez, inceleme açılır.
- **Yazma** — atomik yazma (geçici dosya + yeniden adlandırma), isteğe bağlı içerik doğrulaması, yeniden deneme, eşzamanlı hedefler ve dosyalar, hedef başına bant genişliği sınırı, iptal, eski yedeklerin temizlenmesi.
- **Kopyalama sonrası komut** — `{source}` son gönderilen öğe, `{destination}` o öğenin hedefteki yoludur.
- **Hedef türleri** — SMB paylaşımı, klasör/bağlı sürücü, SFTP.
- **Yapılandırma düzenleyici** — config dosyası JSON olarak düzenlenir, yazarken ve kaydederken denetlenir, yazıldığı gibi kaydedilir; başka dosya yüklenebilir, kopyası dışa aktarılabilir.
- **Açılışlar arası** — açık sayfa, Gönder sekmeleri, kaydedilmemiş senkron işi ve Yedekler girişi korunur; kaydedilmemiş ayarlar varken sayfadan çıkmak ya da kapatmak önce sorar.
- **Taşınabilir sürümler** — tek dosyalı exe ve zip; ayarlar ve geçmiş programın yanındaki `SamSync-data` klasöründe durur.
- **Eski yapılandırma** — eski `config.json` doğrudan okunur; kaydederken eski aracın alanları korunur.
  - Makine tanıma kuralları aynıdır (ortam değişkeni `SAMSYNC_NODE_ID`, `<ad>.<USERDNSDOMAIN>` dahil).
  - Grup adları node kimliğiyle aynı karakterlerle sınırlıdır.
- **Otomatik güncelleme** — GitHub Releases, web adresi ya da ağ klasörü. GitHub Actions Windows, macOS ve Linux paketlerini üretir; üçü de geçince sürümü kendisi yayımlar.
- **Görünüm**
  - Türkçe ve İngilizce arayüz; varsayılan olarak bilgisayarın dili izlenir.
  - Koyu (varsayılan), açık ve sistemle eşlenen tema; vurgu rengi; sıkı yoğunluk.
  - Komut paleti (`Ctrl+K`).
