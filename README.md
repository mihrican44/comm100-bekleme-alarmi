# Comm100 Bekleme Alarmı

Manifest V3 Chrome eklentisi. Comm100 / Lively Chat ajan konsolundaki yanıtsız müşteri sürelerini tarar; en uzun bekleme eşiği aşınca **yüksek siren** çalar. İsterseniz kendi MP3/WAV dosyanızı da ekleyebilirsiniz.

Class ve id’ler dinamik olduğu için tarama metin ve aria etiketlerine dayanır.

## Kurulum

1. Bu klasörü bilgisayarınıza alın.
2. Chrome’da `chrome://extensions` sayfasını açın.
3. Sağ üstten **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle** ile bu dizini seçin. Güncelleme sonrası **Yenile**ye basın.
5. [Comm100 ajan konsolu](https://dash15.lively-chat.com/agentconsole/) oturumunu açın.
6. Alarmın çalabilmesi için konsola **bir kez tıklayın** (tarayıcı otomatik oynatma politikası).

## Kullanım

Eklenti simgesine tıklayın.

- **Sesli uyarı:** alarmı açar / kapatır
- **Eşik süresi:** varsayılan 120 saniye
- **Ses düzeyi:** varsayılan %100
- **Ses dosyası ekle:** kendi alarmınız (MP3 / WAV / OGG, en fazla 2 MB)
- **Alarmı dene:** sireni veya yüklediğiniz dosyayı 3 saniye çalar
- **5 dk sessiz:** geçici susturma

Eşik `chrome.storage.sync` üzerinde tutulur; özel ses `chrome.storage.local` içindedir. `content.js` değişikliği sayfa yenilenmeden alır.

Temsilci yanıt verdiğinde, sayaç sıfırlandığında veya sohbet kapandığında alarm kesilir.

## Desteklenen zaman biçimleri

| Biçim | Örnek | Saniye |
| --- | --- | --- |
| `mm:ss` | `02:15` | 135 |
| `hh:mm:ss` | `1:02:03` | 3723 |
| `Xm Ys` | `2m 15s` | 135 |
| `Xs` | `45s` | 45 |

## Mimari

| Dosya | Görev |
| --- | --- |
| `manifest.json` | MV3, host izinleri, content script, popup |
| `content.js` | 2 sn tarama, regex parser |
| `alarm.js` | Yüksek siren + özel ses oynatıcı |
| `sounds/alarm.wav` | Dahili uyandırma sireni |
| `background.js` | Varsayılan ayarlar, sekme rozeti |
| `popup.html` / `popup.js` | Eşik, ses düzeyi, dosya yükleme |

Host izinleri: `https://*.lively-chat.com/*`, `https://*.comm100.com/*`, `https://*.comm100app.com/*`.

İzinler: `storage`, `activeTab`, `unlimitedStorage`.

## Yerel demo

```bash
python3 -m http.server 43147 --bind 127.0.0.1
```

`http://127.0.0.1:43147/demo/` — demo eşiği 30 sn, eklentide 120 sn.

## Gizlilik

Ayarlar tarayıcı deposunda tutulur. Sohbet içeriği dışarı gönderilmez. Yüklediğiniz ses dosyası yalnızca bu cihazda saklanır.
