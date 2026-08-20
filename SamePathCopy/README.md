# SamePathCopy

Windows Explorer sağ tık menüsünden bir veya birden fazla dosya ya da klasörü seçilen bilgisayarlara kopyalar. Aynı hedefler Notepad++ sekme sağ tık menüsünde de kullanılabilir. Yapılandırılmış kök dizinler arasındaki göreli yolu korur; kaynak öğeleri silmez.

Örnek:

```text
C:\ActiveRelease\Data\EntityConfigurations\ModelHeavyIndustry\Ornek300LC.entity
```

Yerel node'un `localRoot` değeri `C:\ActiveRelease`, uzak node'un `networkRoot` değeri `Sim\Samet` ise `10.10.2.181` hedefinde şuraya kopyalanır:

```text
\\10.10.2.181\Sim\Samet\Data\EntityConfigurations\ModelHeavyIndustry\Ornek300LC.entity
```

Klasör seçildiğinde klasörün kendisi ve bütün içeriği aynı konuma kopyalanır.

## Sürüm takibi

Uygulamanın sürümü `config.json` dosyasındaki `version` alanında tutulur:

```json
{
  "version": "1.0.0",
  "menuTitle": "SamePathCopy"
}
```

Sürüm numarası `MAJOR.MINOR.PATCH` (SemVer) biçimindedir. Yeni paket paylaşılırken davranışı bozan değişikliklerde `MAJOR`, geriye uyumlu özelliklerde `MINOR`, hata düzeltmelerinde `PATCH` artırılmalıdır. Sürüm, kopyalama sonuç penceresinin başlığında ve yerel kök satırında görünür.

Sürüm değişiklikleri [CHANGELOG.md](CHANGELOG.md) dosyasında listelenir.

### Birden fazla kaynak kökü

Bir node birden fazla kaynak kökü tanımlayabilir. Kaynak hangi kökün altındaysa göreli yol o köke göre hesaplanır ve hedefte aynı `networkRoot` altına yazılır:

```json
{
  "id": "Root",
  "name": "Root - 10.10.2.82",
  "address": "10.10.2.82",
  "localRoots": [
    "C:\\E\\repo\\musteri\\proje",
    "C:\\E\\repo\\musteri\\simulatorexternaldata",
    "C:\\E\\repo\\musteri\\simcontents"
  ],
  "networkRoot": "proje",
  "enabled": true
}
```

Hedefin `networkRoot` değeri `Sim\ActiveRelease` ise:

```text
proje\Data\x.entity            -> \\10.10.1.11\Sim\ActiveRelease\Data\x.entity
simulatorexternaldata\ses\a.wav -> \\10.10.1.11\Sim\ActiveRelease\ses\a.wav
simcontents\model\b.fbx        -> \\10.10.1.11\Sim\ActiveRelease\model\b.fbx
```

Göreli yol doğrudan `networkRoot` altına yazıldığı için iki kökte aynı göreli yol varsa (`proje\Data\x` ve `simcontents\Data\x`) hedefte aynı dosyaya denk gelirler; kökleri buna göre seçin. Sonuç penceresi ve `-PlanOnly` çıktısı her öğe için hangi kökün eşleştiğini gösterir.

İç içe kökler tanımlanabilir; en uzun eşleşen kök kullanılır. Tek köklü eski yapılandırmalar `localRoot` alanıyla çalışmaya devam eder; iki alan birlikte verilirse `localRoot` ilk kök olur.

### Kökler dışındaki öğeler

Seçilen öğe yerel node'un köklerinden birinin içindeyse, o kökün altındaki göreli yol hedef `networkRoot` altında korunur.

Öğe köklerin hiçbirinin altında değilse tam yerel yol sürücü harfi bir klasöre dönüştürülerek korunur:

```text
C:\Fraps\README.HTM
→ \\10.10.2.181\Sim\Samet\C\Fraps\README.HTM
```

Bu sayede farklı sürücülerde aynı ada sahip yollar çakışmaz. UNC kaynakları `networkRoot\UNC\sunucu\paylaşım\...` altında saklanır.

### Gruplar

Node'lara `group` alanı verilerek makineler kümelenir. Menüde her grup için, o gruptaki bütün makinelere gönderen tek bir girdi oluşur:

```json
{
  "id": "Unit1IG1",
  "group": "Unit1",
  "name": "IG1 - 10.10.2.11",
  "address": "10.10.1.11",
  "localRoot": "C:\\Sim\\ActiveRelease",
  "networkRoot": "Sim\\ActiveRelease",
  "enabled": true
}
```

Menü sırası: en üstte `Tümü`, ardından her grup girdisi kendi makinelerinin başında, en sonda gruba ait olmayan makineler:

```text
Tümü                        (ikonlu)
Unit1                  (ikonlu)
  Eğitmen - 10.10.1.10
  IG1 - 10.10.2.11
  IG2 - 10.10.2.12
  IG3 - 10.10.2.13
Unit2                  (ikonlu)
  ...
```

İkon yalnızca toplu girdilerde (`Tümü` ve gruplar) durur; tek makine girdileri ikonsuzdur; böylece iki tür girdi menüde bakışta ayrışır.

Grup girdileri komutlara `-TargetId group:Unit1` biçiminde geçer; `Queue-SamePathCopy.ps1` ve `Copy-SamePath.ps1` bu kimliği doğrudan kabul eder. Yerel bilgisayar kendi grubunun girdisinden de çıkarıldığı için, Unit1 eğitmeninde `Unit1` seçmek yalnızca o setin IG'lerine gönderir. Grubun bu bilgisayar dışında etkin üyesi kalmazsa grup girdisi menüde hiç oluşmaz.

Klavye kısayolu da atanabilir; `notepadPlusPlusShortcuts` anahtarı grup kimliğini kabul eder:

```json
"notepadPlusPlusShortcuts": {
    "all": "Ctrl+Alt+W",
    "group:Unit1": "Ctrl+Alt+1"
}
```

### Birden fazla dosya ve klasör

Explorer'da birden fazla dosya, birden fazla klasör veya karışık dosya/klasör seçimi yapılabilir. Seçimler kısa bir kuyrukta birleştirilir ve tek sonuç penceresinde bütün kaynak-hedef kopyalamaları gösterilir.

Registry tabanlı legacy Windows menü modelinin sınırı nedeniyle en fazla 15 öğelik seçim desteklenir. Daha fazla öğe seçildiğinde Windows menüyü göstermeyebilir.

## Tek yapılandırmayı bütün bilgisayarlarda kullanma

Aynı `config.json` eğitmen ve bütün IG bilgisayarlarında **hiç değiştirilmeden** kullanılır. Eğitmen dahil her bilgisayar `nodes` listesinde bulunur ve kendi yerel/paylaşım köklerine sahiptir. Araç çalıştığı bilgisayarı, en belirleyici ölçütten başlayarak otomatik tanır:

1. `SAMEPATHCOPY_NODE_ID` ortam değişkeni (ya da `Get-LocalSamePathCopyIdentity -NodeId`) verilmişse doğrudan o node kullanılır.
2. `address` alanının yerel IP adreslerinden biriyle eşleşmesi.
3. `address` veya isteğe bağlı `localNames` değerlerinden birinin Windows bilgisayar adıyla eşleşmesi.
4. Bir kademede birden fazla node eşleşirse, `localRoot` dizini bu bilgisayarda var olan tek node seçilir.

IP eşleşmesi ada göre eşleşmeyi ezdiği için, bilgisayar adları benzersiz olmasa bile (örneğin bütün makinelerin adı `MSI` olsa bile) her bilgisayar kendi node'unu bulur. Ada göre birden fazla eşleşme kalan durumda ayrımı `localRoot` yapar: eğitmen kökü `D:\Sim\ActiveRelease`, geliştirme makinesinin kökü `C:\E\repo\musteri\proje` ise yalnızca gerçekten var olan kökün node'u seçilir.

Hiçbir kademe tek bir node'a inemezse araç kopyalama yapmaz ve hangi node'ların eşleştiğini söyler. Bu durumda ya bu bilgisayarın adresi/adı tek bir node'da bırakılır, ya `localRoot` değerleri ayrıştırılır, ya da yalnızca o bilgisayarda `setx SAMEPATHCOPY_NODE_ID Unit1Trainer` gibi bir ortam değişkeniyle kimlik sabitlenir; config dosyası ortak kalır.

Eşleşen node'un `localRoot` değeri kaynak kökü olarak kullanılır ve o node kendi hedef listesinden çıkarılır. Uzak node'a gönderimde `\\address\networkRoot` kullanılır.

Örnek olarak IG-12 üzerinde çalışırken:

```json
{
  "id": "sim-12",
  "address": "10.10.2.12",
  "localNames": ["IG-12"],
  "localRoot": "E:\\Samet",
  "networkRoot": "Sim\\Samet"
}
```

Araç bu bilgisayarda `E:\Samet` dizinini göreli yol hesabının yerel kökü olarak kullanır. Kaynaklar bu kökün dışında da seçilebilir; bu durumda sürücü harfi dahil tam yol hedef altında korunur. Başka bilgisayarlar bu node'a `\\10.10.2.12\Sim\Samet` üzerinden gönderir.

Eğitmen bilgisayar da aynı `nodes` listesinde olduğu için IG bilgisayarlarından eğitmene doğrudan dosya gönderilebilir.

Dosyanın fiziksel olarak da tek kopya olması istenirse `config.json` ortak bir salt-okunur ağ paylaşımına konabilir ve her bilgisayarda kurulum şu şekilde yapılabilir:

```bat
Install-ContextMenu.bat -ConfigPath "\\dosya-sunucusu\ProjeConfig\config.json"
```

Kurulum, bu merkezi config yolunu sağ tık komutlarına kaydeder. Bilgisayarların paylaşımı okuyabilmesi gerekir. Menü yapısını etkileyen `menuTitle`, `allLabel`, node ekleme/silme, `name`, `id` veya `enabled` değişikliklerinden sonra kurulum tekrar çalıştırılmalıdır. Yerel node tespitini değiştirebileceği için `address` veya `localNames` değişikliklerinden sonra da kurulumu yenilemek en güvenli yöntemdir. `localRoot`, `networkRoot`, `version` ve `copy` ayarları her işlem başında config dosyasından yeniden okunur ve tek başlarına menünün yeniden kurulmasını gerektirmez.

## Ön koşullar

- Windows PowerShell 5.1 ve Windows Explorer kullanılmalıdır.
- Notepad++ sekme menüsü bütünleşmesi için Notepad++ 8.4.8 veya üzeri gerekir. Notepad++ zorunlu değildir; bulunmazsa bu adım atlanır.
- Hedef bilgisayarlarda `networkRoot` değerinin ilk parçasıyla aynı adda SMB paylaşımı bulunmalı. `Sim\Samet` için `Sim` paylaşımı gerekir.
- İşlemi yapan Windows kullanıcısının hedef paylaşımına yazma yetkisi olmalı.
- Güvenlik duvarında Windows Dosya ve Yazıcı Paylaşımı açık olmalı.
- Her node'un yerel klasörü `localRoot`, ağdan erişilen paylaşım yolu `networkRoot` ile ayrı ayrı tanımlanır.

Etki alanı dışındaki bilgisayarlarda kimlik bilgisini Windows Credential Manager'a bir kez kaydetmek gerekebilir:

```powershell
cmdkey /add:10.10.2.11 /user:HEDEF-BILGISAYAR\Kullanici /pass
```

Komut parolayı etkileşimli ister; parolayı `config.json` içine yazmayın.

## Node'ları ayarlama

`config.json` içindeki `nodes` dizisine eğitmen dahil bütün bilgisayarları ekleyin:

```json
{
  "id": "sim-14",
  "name": "Operatör Kabini 14 (10.10.2.14)",
  "address": "10.10.2.14",
  "localNames": ["IG-14"],
  "localRoot": "E:\\GuncelSurum",
  "networkRoot": "Sim\\GuncelSurum",
  "enabled": true
}
```

- `id`: Menü komutunun kalıcı anahtarıdır. `Trainer`, `IG1`, `IG2` gibi büyük veya küçük İngilizce harfler, rakam, nokta, alt çizgi ve tire kullanılabilir. Baştaki/sondaki boşluklar otomatik temizlenir. Kimlikler büyük/küçük harfe duyarsız olarak benzersiz olmalıdır; örneğin `IG1` ile `ig1` aynı kimlik kabul edilir. `all` değeri “Tümü” işlemi için ayrılmıştır ve node kimliği olarak kullanılmamalıdır.
- `name`: Menüde görünen serbest metindir.
- `address`: IPv4 adresi veya DNS/Windows bilgisayar adıdır.
- `localNames`: İsteğe bağlı Windows bilgisayar adı veya adlarıdır. IP adresi değişken olan (DHCP ya da Wi-Fi ile bağlanan) bilgisayarların tanınmasını sağlar. Aynı adı birden fazla node'a yazmak eşleşmeyi belirsizleştirir; o durumda ayrımı IP eşleşmesi veya `localRoot` varlığı yapar.
- `group`: İsteğe bağlı grup adıdır. Aynı grup adını taşıyan node'lar için menüde tek tıkla o grubun tamamına gönderen bir girdi oluşur. Node kimliğiyle aynı karakterler kullanılabilir (`Unit1` gibi; boşluk yok). Büyük/küçük harf farkı gözetilmez.
- `localRoot`: Bu bilgisayar kaynak olduğunda göreli yol hesabının başlangıcı olan, sürücü harfiyle başlayan mutlak yerel yoldur. Örnek: `E:\Samet`. Bu dizin dışındaki öğeler de tam yolları korunarak kopyalanabilir.
- `localRoots`: Birden fazla kaynak kökü için kullanılan listedir; `localRoot` yerine ya da onunla birlikte verilebilir. Her kök sürücü harfiyle başlayan mutlak bir yoldur. Ayrıntı için [Birden fazla kaynak kökü](#birden-fazla-kaynak-kökü) bölümüne bakın.
- `networkRoot`: Bilgisayar hedef olduğunda kullanılan, paylaşım adıyla başlayan yoldur. `Sim\Samet` değeri `\\IP\Sim\Samet` üretir.
- `enabled`: `false` yapılırsa hedef menüden ve “Tümü” işleminden çıkar.

Uygulama sürümü `version`, üst menü adı `menuTitle`, tüm hedefler seçeneğinin adı `allLabel` alanından değiştirilebilir. `copy.retryCount`, başarısız kopyalama denemelerinin tekrar sayısını; `copy.waitSeconds` ise tekrarlar arasındaki bekleme süresini belirler. İzin verilen aralıklar sırasıyla `0-100` ve `0-60` saniyedir.

## Kurulum

Önerilen yöntem `Install-ContextMenu.bat` dosyasına çift tıklamaktır. BAT dosyası PowerShell betiğini yalnızca bu işlem için `ExecutionPolicy Bypass` ile çalıştırır; bilgisayarın kalıcı PowerShell güvenlik politikasını değiştirmez.

Komut satırından da çalıştırılabilir:

```bat
Install-ContextMenu.bat
```

Merkezi veya farklı bir config kullanılacaksa parametre BAT dosyasına verilebilir:

```bat
Install-ContextMenu.bat -ConfigPath "\\dosya-sunucusu\ProjeConfig\config.json"
```

PowerShell betiğini doğrudan çalıştırmak isterseniz execution policy engeline takılmamak için şu komutu kullanın:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\Install-ContextMenu.ps1"
```

Kurulum yalnızca mevcut kullanıcıya, `HKCU` altında yapılır; yönetici yetkisi gerekmez. Menü yapısını etkileyen config değişikliklerinden sonra kurulum betiğini tekrar çalıştırın. Explorer'ı yeniden başlatmak normalde gerekmez.

Kurulum sistemde Notepad++ 8.4.8 veya üzerini bulursa sekme sağ tık bütünleşmesini de otomatik kurar. Standart kurulumların `%APPDATA%\Notepad++` ayar klasörü ve `doLocalConf.xml` kullanan taşınabilir kurulumlar desteklenir. Mevcut `shortcuts.xml` ve `tabContextMenu.xml` içerikleri silinmez; yalnızca adı `[SamePathCopy]` ile başlayan yönetilen komutlar güncellenir.

Notepad++ kapanırken `shortcuts.xml` ve `config.xml` dosyalarını kendi belleğindeki içerikle yeniden yazar. Bu nedenle kurulumu Notepad++ kapalıyken çalıştırın; açıkken çalıştırdıysanız uygulamayı kapatıp betiği bir kez daha çalıştırın.

### shortcuts.xml bütünlük imzası

Notepad++ 8.9.6.2 ve üzeri, bir kullanıcı komutunu çalıştırmadan önce `shortcuts.xml` dosyasının bütünlüğünü doğrular (CVE-2026-48800). İmza, makine GUID'i anahtarıyla üretilen HMAC-SHA256 değeridir ve `config.xml` içinde `<GUIConfig name="shortcutsXmlHMAC" value="..." />` olarak tutulur. İmza eksik ya da eşleşmiyorsa Notepad++ komutu çalıştırmaz; `shortcuts.xml` dosyasını salt okunur açıp **Security Warning** uyarısını gösterir.

Kurulum ve kaldırma, `shortcuts.xml` dosyasını yazdıktan sonra bu imzayı `config.xml` içinde günceller; ek bir adım gerekmez. İmza yazılamazsa (`config.xml` bulunamaması veya makine GUID'inin okunamaması) betik uyarı verir; bu durumda Notepad++ içinde **Çalıştır (Run) > Validate shortcuts.xml** komutunu bir kez kullanmak yeterlidir.

### Klavye kısayolu atama

Notepad++ komutlarına klavye kısayolu `config.json` içindeki `notepadPlusPlusShortcuts` alanından atanır. Anahtar hedef kimliğidir; tüm hedeflere kopyalayan girdi için `all` kullanılır:

```json
"notepadPlusPlusShortcuts": {
    "all": "Ctrl+Alt+W",
    "IG1": "Ctrl+Alt+F5"
}
```

Varsayılan yapılandırmada `all` için `Ctrl+Alt+W` tanımlıdır: Notepad++ içinde `Ctrl+Alt+W`, aktif sekmedeki kaydedilmiş dosyayı tüm hedeflere kopyalar. Değişikliğin etkin olması için kurulumu Notepad++ kapalıyken çalıştırın; kısayol Notepad++ açılışında yüklenir ve **Ayarlar > Kısayol Eşleyici > Run komutları** altında görünür.

Kısayol metni `Ctrl`, `Alt`, `Shift` değiştiricilerini ve tek bir tuşu (`A-Z`, `0-9`, `F1-F24`, `Insert`, `Delete`, `Home`, `End`, `PageUp`, `PageDown`, `Up`, `Down`, `Left`, `Right`, `Space`, `Tab`, `Enter`, `Backspace`, `Esc`) kabul eder. Harf ve rakamlar en az bir değiştirici tuş gerektirir. Tanınmayan tuş, birden fazla tuş veya aynı kısayolun iki hedefe atanması kurulumu hatayla durdurur; menüde bulunmayan bir kimlik yalnızca uyarı üretir.

Kurulum, istenen kısayolun `shortcuts.xml` içindeki başka bir makro/komutla çakışmasını denetleyip uyarır. Notepad++'ın kendi varsayılan kısayolları bu dosyada tutulmadığı için denetlenemez; `Ctrl+Alt+W` Notepad++ 8.9.7 varsayılanlarında boştur (`Ctrl+W` sekmeyi kapatır, `Ctrl+Shift+W` tümünü kapatır).

### Run komutu 260 karakter sınırı

Notepad++, sekme menüsündeki komut satırını `$(FULL_CURRENT_PATH)` gibi değişkenleri açmadan önce 260 karaktere kırpar ve uyarı vermez; kırpılan komut çalıştığında "Cannot find path ... because it does not exist" gibi hatalar görülür. Kurulum bu yüzden komutu kısa tutar: kısa PowerShell anahtarları (`-nop -w hidden -ep bypass -f`) kullanılır ve `-ConfigPath` yalnızca betiğin yanındaki varsayılan `config.json` dışında bir dosya kullanıldığında yazılır. `Queue-SamePathCopy.ps1` çağrısında `-ConfigPath` verilmezse betiğin yanındaki `config.json` kullanılır.

Aracın veya özel config dosyasının yolu yine de sınırı aşacak kadar uzunsa kurulum, bozuk bir menü girdisi yazmak yerine o girdiyi atlar ve uyarı verir. Bu durumda aracı daha kısa bir yola (örnek: `C:\SamePathCopy`) taşıyıp kurulumu yeniden çalıştırın.

Kurulum, `assets\SamePathCopy.ico` dosyasını ana menüye ve hedef alt menülerine bağlar. Araç klasörü paylaşılırken `assets` klasörünü de pakete dahil edin.

Windows 11'de klasik Explorer uzantısı ilk menü yerine **Daha fazla seçenek göster** (`Shift+F10`) altında görüntülenebilir.

Araç klasörünü kurulumdan sonra taşımayın; kayıt defterindeki komut betiğin mevcut tam yolunu kullanır.

## Kullanım

1. Bir veya birden fazla dosya/klasör seçip sağ tıklayın.
2. **SamePathCopy** menüsünü açın. Menü adı `config.json` içindeki `menuTitle` ile değiştirilmişse yapılandırılan adı kullanın.
3. Tek bir bilgisayarı veya **Tümü** seçeneğini seçin.
4. Açılan sonuç penceresinden her hedefin durumunu kontrol edin.

Notepad++ içinde kaydedilmiş bir dosyanın sekmesine sağ tıklayıp **SamePathCopy** alt menüsünden aynı hedefler seçilebilir. İsimsiz, henüz kaydedilmemiş sekmelerin dosya sistemi yolu olmadığı için önce kaydedilmeleri gerekir. Sekmede kaydedilmemiş değişiklik varsa kopyalanan içerik diskteki son kaydedilmiş sürümdür.

`robocopy` dönüş kodu `0-7` başarılı, `8` ve üzeri hatalı kabul edilir. Var olan dosyalar gerektiğinde güncellenir; hedefte olup kaynakta bulunmayan dosyalar silinmez.

Sonuç penceresi diğer uygulamaların üzerinde sabitlenmez; normal bir pencere gibi arkaya alınabilir. SMB paylaşımına erişilemiyorsa veya `robocopy` hata verirse sonuç alanında Windows'un ayrıntılı hata mesajı gösterilir.

### Robocopy 16 ve erişim reddedildi

`robocopy` kodu `16`, hedef yolun bulunamaması, hatalı kullanım veya yetersiz erişim yetkisi gibi ciddi bir hatayı belirtir. `Hedef SMB paylaşımına erişilemiyor` ya da `Access is denied` görülürse hedef bilgisayarda hem paylaşım izni hem de klasörün NTFS Güvenlik izni kontrol edilmelidir. Kaynak bilgisayardaki kullanıcıya hedef paylaşımda değiştirme/yazma yetkisi verilmelidir.

Gerekirse doğru hedef hesabı Windows Credential Manager'a kaydedin:

```bat
cmdkey /add:10.10.2.182 /user:HEDEF-BILGISAYAR\Kullanici /pass
```

Önceden aynı IP için yanlış kimlik bilgisi kaydedilmişse `cmdkey /delete:10.10.2.182` ile kaldırıp yeniden ekleyin.

## Yapılandırmayı değiştirmeden sınama

Gerçek kopyalama yapmadan hedef yolu görmek için:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ".\Copy-SamePath.ps1" -SourcePath "C:\ActiveRelease\Data\EntityConfigurations\ModelHeavyIndustry\Ornek300LC.entity" -TargetId all -PlanOnly
```

`PlanOnly` kaynak öğenin varlığını ve yerel bilgisayarın config içindeki bir node ile eşleşmesini doğrular, hesaplanan hedefleri ekrana yazar ve `robocopy` çalıştırmaz. Tek hedefi sınamak için `all` yerine ilgili node kimliğini verin.

## Kaldırma

`Uninstall-ContextMenu.bat` dosyasına çift tıklayın veya komut satırından çalıştırın:

```bat
Uninstall-ContextMenu.bat
```

Bu işlem Explorer sağ tık kayıtlarını ve Notepad++ içindeki SamePathCopy komutlarını kaldırır; diğer Notepad++ özelleştirmelerini, betikleri, yapılandırmayı veya kopyalanmış dosyaları silmez.
