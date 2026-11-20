# İmzaKayıt

Karşı tarafa tek kullanımlık link atıp dijital sözleşme imzalatmak, imzalandığı anda haberdar olmak ve imzalı belgeyi bütünlük kanıtıyla saklamak için yazdığım web uygulaması. Yerelde sıfır bağımlılıkla Node.js (20+) sunucusu üzerinde çalışıyor; `localhost` dışındaki ortamlarda otomatik olarak Firebase Hosting + Cloud Firestore moduna geçiyor.

Panelden sözleşmeyi oluşturup `/imza/:token` bağlantısını paylaşıyorum. Karşı taraf imzalayana kadar metni güncelleyebiliyor veya bağlantıyı iptal edebiliyorum. İmza adımında isteğe bağlı 6 haneli PIN doğrulaması (`SHA-256` özet kontrolü) ve çizimli ya da yazılı imza alınıyor. `autoBurnAfterSign` açık olduğunda imza tamamlandığı anda bağlantı dışarıya kapanıyor; belge sonradan yalnızca yönetici panelinden ve arşivden açılabiliyor. Bağlantı görüntülendiğinde veya imzalandığında panelde canlı bildirim düşüyor (yerelde SSE, Firebase tarafında `onSnapshot`), imzalı tek dosya `.html` arşivi otomatik iniyor; istenirse Telegram botu veya webhook da bağlanabiliyor. İçerik, imza ve zaman damgası üzerinden üretilen `SHA-256` kayıtları `/dogrula` sayfasından kontrol edilebiliyor.

Yerel modda harici paket yok. Parolalar tuzlanmış `scrypt`, oturumlar `HMAC-SHA256` imzalı `HttpOnly` çerez ve `RateLimiter` ile korunuyor; üretilen HTML arşivlerinde XSS kaçışı ve PNG data URL doğrulaması var. Firebase tarafında tüm erişim `firestore.rules` ile tek bir yönetici UID'sine (`config/admin`) kilitli; listeleme, oluşturma, silme, PIN kayıtları (`admin_secrets`) ve bildirim ayarları (`config/settings`) yalnızca bu hesaba açık. Karşı taraf sadece 192-bit rastgele token'ını bildiği belgeyi açıp imzalayabiliyor. Yerel veriler (`data/`, `imzalanan_sozlesmeler/`) ve Firebase yapılandırması (`public/app/firebase-config.js`) `.gitignore` ile repo dışında tutuluyor.

Yerelde çalıştırmak için (`http://localhost:3000`, ilk açılışta yönetici şifresi ister veya `ADMIN_PASSWORD` env okur):

```bash
npm start
npm test
```

Firebase üzerinde yayınlamak için örnek yapılandırmayı kopyalayıp kendi proje bilgilerini girmek yeterli (Hosting altında `/__/firebase/init.json` fallback desteği de var):

```bash
cp public/app/firebase-config.example.js public/app/firebase-config.js
firebase deploy --only firestore,auth,hosting --project <PROJECT_ID>
```

Burada üretilen zaman damgası ve `SHA-256` özeti teknik bütünlük kanıtı sağlar; 5070 sayılı Elektronik İmza Kanunu kapsamındaki nitelikli e-İmza yerine geçmez.
