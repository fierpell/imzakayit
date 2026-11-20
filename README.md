# İmzaKayıt

Bu projeyi karşı tarafa tek seferlik link atıp dijital sözleşme imzalatmak, imzalandığı anda da haberdar olup belgeyi elime almak için yazdım. Sıfır harici paketle direkt Node.js (20+) üzerinden ayağa kalkıyor. Canlıda (`localhost'un` dışında) çalıştırınca da otomatik olarak Firebase Hosting ve Firestore moduna geçiyor.

Panelden sözleşmeyi oluşturup `/imza/:token` linkini paylaşıyorsunuz. Karşı taraf imzalayana kadar metni güncelleyebiliyorsunuz veya linki iptal edebiliyorsunuz. İmza ekranında çizimli ya da yazılı imza ve isterseniz 6 haneli PIN doğrulaması var. İmza atıldığı an link dışarıya kapanıyor (`autoBurnAfterSign` ile). Panel açıksa SSE veya `onSnapshot` üzerinden anlık bildirim düşüp imzalı `.html` arşivi direkt bilgisayarınıza iniyor. Telegram botu veya webhook bağlamak da mümkün. İmzalanan belgelerin değiştirilmediğini `/dogrula` sayfasından SHA-256 ile kontrol edebiliyorsunuz.

Güvenlik tarafında yerelde parolalar salted scrypt, oturumlar HMAC-SHA256 imzalı HttpOnly cookie ve rate limiter ile korunuyor. Firebase kısmında `firestore.rules` ilk kurulumda tek bir admin UID'sine kilitleniyor. Listeleme, oluşturma, silme ve PIN kayıtları sadece admin hesabına açık, karşı taraf sadece token'ını bildiği belgeyi açıp imzalayabiliyor. Yerel veriler ve kişisel Firebase ayarları `.gitignore` içinde olduğu için repoda özel veri durmuyor.

Yerelde çalıştırmak ve testleri koşmak için:

```bash
npm start
npm test
```

Kendi Firebase projene kurmak istersen örnek config dosyasını kopyalayıp kendi bilgilerini girmen yeterli:

```bash
cp public/app/firebase-config.example.js public/app/firebase-config.js
firebase deploy --only firestore,auth,hosting --project PROJE_ID
```

Not: Buradaki imza ve SHA-256 kaydı teknik bütünlük kanıtı için, 5070 sayılı kanun kapsamındaki resmi e-İmza yerine geçmez.
