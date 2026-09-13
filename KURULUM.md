# Kurulum

Bu bir Chrome eklentisidir. Demo sayfası yalnızca test içindir.

## 1. Klasörü bilgisayara alın

Zip indirdiyseniz açın. Klasörün içinde `manifest.json`, `content.js`, `popup.html` ve `sounds/` olmalı.

## 2. Chrome’a yükleyin

1. Chrome’u açın.
2. Adres çubuğuna `chrome://extensions` yazıp Enter’a basın.
3. Sağ üstten **Geliştirici modu**nu açın.
4. Eski **Mesaj Süre Takip** / önceki bekleme eklentisi varsa **Kaldır**ın.
5. **Paketlenmemiş öğe yükle** → `manifest.json` görünen klasörü seçin.
6. Listede **Mesaj Süre Takip** görünür. Puzzle ikonundan sabitleyin.

Kod güncellenince aynı sayfada eklentinin **Yenile** düğmesine basın.

## 3. Sohbet ekranını açın

1. Canlı destek sohbet listesini açın (`/agentconsole/chats`).
2. Sayfaya **bir kez tıklayın** (ses için).
3. Eklenti simgesinden eşiği ayarlayın.
4. **Alarmı dene** ile sesi kontrol edin.

Sohbet sekmesini kapatmayın. Başka sekmeye geçseniz de eklenti bu ekranı arkada izler.

Yanıtlayınca sol listedeki sayaç 0 olur; alarm durur. Sağdaki uzun oturum süresi kullanılmaz.

Ses yoksa popup’ta ses düzeyi %0 olmasın.

## Çalışmazsa

- Sohbet listesi sekmesi açık mı?
- Eklentiyi Yenile + sohbet sekmesini yenileyin.
- Adres çubuğunda eklenti izni istenirse **İzin ver**in.
- **Alarmı dene**yin; sistem sesi kısık olmasın.
