# İmzaKayıt — Dijital Sözleşme, Onay ve Arşivleme Sistemi

İçeriği tamamen düzenlenebilir sözleşme veya mutabakat metinleri hazırlayıp tek kullanımlık bağlantı (`/imza/:token`) üzerinden karşı tarafa göndermenizi, dokunmatik/yazılı imza ve isteğe bağlı **6 haneli onay kodu (PIN)** ile onay almanızı, anlık bildirimler almanızı ve imzalanan belgeleri **SHA-256** bütünlük doğrulamasıyla arşivlemenizi sağlayan web uygulamasıdır.

Proje hem **bağımlılıksız yerel Node.js sunucusu** hem de **Firebase Hosting + Cloud Firestore + Firebase Auth** altyapısıyla çalışacak şekilde tasarlanmıştır.

---

## Öne Çıkan Özellikler

- **Düzenlenebilir Sözleşme Editörü:** Başlık, taraflar ve Markdown benzeri biçimlendirme (`##` başlık, `-` liste, `**kalın**`) ile sözleşmeler oluşturulur; karşı taraf imzalayana kadar içerik güncellenebilir veya bağlantı iptal edilebilir. Hazır başlangıç şablonları içerir.
- **2 Adımlı Mobil/Web İmza Akışı (`/imza/:token`):**
  - Mobil ve masaüstü uyumlu dokunmatik imza alanı (el ile çizim veya yazılı imza).
  - İsteğe bağlı **6 haneli onay kodu (PIN)** doğrulaması (`SHA-256` özet kontrolü).
  - Açık rıza ve beyan onayı.
- **Tek Kullanımlık / Otomatik Kapanan Bağlantı (`autoBurnAfterSign`):** Belge imzalandığı anda dışarıya kapatılabilir; yalnızca yönetici ve elindeki arşiv kopyası üzerinden görüntülenebilir.
- **Anlık Bildirimler:**
  - Yerel sunucuda **Server-Sent Events (SSE)**, Firebase modunda gerçek zamanlı **Firestore `onSnapshot`** dinlemesi ve tarayıcı masaüstü bildirimi.
  - Belge imzalandığı anda imzalı tek dosya `.html` arşivinin otomatik indirilmesi.
  - **Telegram Bot** ve **Webhook** (Discord, Slack, n8n, Make vb.) entegrasyonu.
- **Kalıcı Arşiv ve SHA-256 Doğrulama (`/arsiv/:token`, `/dogrula`):**
  - İmzalanmış belgeler değiştirilemez şekilde kilitlenir; yazdırılabilir / PDF kaydedilebilir çevrimdışı `.html` arşivi ve kanıt çıktısı üretilir.
  - `/dogrula` sayfası üzerinden belge numarası veya `SHA-256` özeti ile belge bütünlüğü doğrulanabilir.

---

## Güvenlik Mimarisi

- **Firebase Modu ([`firestore.rules`](firestore.rules)):**
  - İlk kurulumda yalnızca tek bir yönetici UID'si `config/admin` belgesine yazılır; bu kayıt sonradan değiştirilemez veya silinemez.
  - Sözleşme listeleme (`list`), yeni sözleşme oluşturma (`create`), silme (`delete`), PIN kodları (`admin_secrets`) ve bildirim/bot ayarları (`config/settings`) yalnızca kimliği doğrulanmış yöneticiye (`isAdmin()`) açıktır.
  - İmzalayan kişi yalnızca kendisine verilen 192-bit rastgele bağlantıyı (`contracts/{token}`) açabilir ve yalnızca bekleyen/görüntülenen belgeyi geçerli rıza/PIN ile `signed` durumuna geçirebilir.
- **Yerel Sunucu Modu:** Yönetici parolası tuzlanmış `scrypt` ile saklanır; `HMAC-SHA256` imzalı oturum çerezleri (`HttpOnly`, `SameSite=Lax`) ve hız sınırlayıcı (`RateLimiter`) kullanılır. Üretilen HTML arşivleri XSS korumalı kaçış (escaping) ve güvenli imza görseli doğrulamasından geçer.
- **Gizli Dosya Ayrımı:** Yerel veriler (`data/`, `imzalanan_sozlesmeler/`) ve kişisel Firebase web yapılandırması (`public/app/firebase-config.js`) `.gitignore` ile sürüm takibinden hariç tutulur.

---

## Kurulum ve Çalıştırma

### Seçenek 1: Yerel Node.js Sunucusu (Hızlı Başlangıç)

Harici `npm` paketi gerektirmez; **Node.js 20+** yerleşik modülleriyle çalışır.

```bash
npm start
```

Tarayıcıdan `http://localhost:3000` adresini açın:
1. İlk açılışta yönetici şifrenizi belirleyin (isteğe bağlı olarak `ADMIN_PASSWORD` ortam değişkeni kullanılabilir).
2. Sözleşmenizi oluşturup **İmza Linkini Kopyala** ile paylaşın.
3. Yerel veriler `data/db.json`, `data/config.json` ve `data/archives/` altında saklanır.

Testleri çalıştırmak için:

```bash
npm test
```

---

### Seçenek 2: Firebase Hosting + Firestore ile Yayınlama

Uygulama `localhost` / `127.0.0.1` dışındaki ortamlarda otomatik olarak Firebase moduna geçer.

1. Örnek yapılandırma dosyasını kopyalayıp kendi Firebase web uygulama bilgilerinizi girin:
   ```bash
   cp public/app/firebase-config.example.js public/app/firebase-config.js
   ```
   *(Alternatif olarak Firebase Hosting varsayılan olarak `/__/firebase/init.json` üzerinden de yapılandırmayı otomatik yükleyebilir.)*
2. Firebase Console'da projeniz için **Cloud Firestore** ve **Authentication (Email/Password)** servislerini etkinleştirin.
3. Güvenlik kurallarını ve barındırmayı yayınlayın:
   ```bash
   firebase deploy --only firestore,auth,hosting --project <FIREBASE_PROJECT_ID>
   ```
4. Yayındaki sitenizi açıp ilk yönetici e-posta ve şifrenizi oluşturun.

---

## Proje Yapısı

```text
├── server.js                           # Yerel HTTP sunucusu ve REST/SSE API
├── lib/
│   ├── auth.js                         # Parola özetleme ve oturum doğrulama
│   ├── storage.js                      # Yerel JSON veritabanı ve arşiv yönetimi
│   ├── notifications.js                # Telegram Bot & Webhook bildirimleri
│   └── render.js                       # Güvenli HTML belge/arşiv oluşturucu
├── public/
│   ├── index.html                      # Yönetici paneli
│   ├── sign.html                       # Sözleşme okuma ve imza sayfası
│   ├── archive.html                    # İmzalı belge görüntüleme ve yazdırma
│   ├── verify.html                     # SHA-256 belge bütünlük doğrulama
│   └── app/
│       ├── firebase-store.js           # Firestore + Auth istemci katmanı
│       └── firebase-config.example.js  # Örnek Firebase ayar şablonu
├── firestore.rules                     # Tek yönetici kilidi ve koleksiyon kuralları
├── firebase.json                       # Hosting rewrite ve Firestore yapılandırması
└── tests/app.test.js                   # Uçtan uca yerel sunucu ve API testleri
```

---

## Hukuki Bilgilendirme

Bu uygulama genel amaçlı dijital onay, zaman damgası ve `SHA-256` belge bütünlük kaydı üretir. Türkiye'deki **5070 sayılı Elektronik İmza Kanunu** kapsamındaki nitelikli elektronik imza (e-İmza / Mobil İmza) yerine geçmez; nitelikli elektronik imza için BTK onaylı Elektronik Sertifika Hizmet Sağlayıcıları (ESHS) entegrasyonu gerekir.
