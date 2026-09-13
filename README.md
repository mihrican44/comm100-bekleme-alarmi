# Mesaj Süre Takip

Canlı sohbet panelinde yanıtsız müşteri mesaj süresini izleyen Chrome eklentisi. Kaynak **yalnızca sol listedeki** `12s` / `2m` rozetidir. Sağdaki oturum süresi yok sayılır. Temsilci yanıtlayınca sayaç **0** olur. Eşik aşılınca siren çalar.

Kurulum: [KURULUM.md](KURULUM.md)

## Kurulum (özet)

1. Bu klasörü bilgisayarınıza alın (`manifest.json` bu dizinde olmalı).
2. Chrome’da `chrome://extensions` → **Geliştirici modu** → **Paketlenmemiş öğe yükle**.
3. Sohbet konsolunu açın, sayfaya bir kez tıklayın.
4. Eklenti simgesinden eşiği ayarlayın.

## Kullanım

- **Sesli uyarı:** aç / kapat
- **Eşik süresi:** varsayılan 120 saniye
- **Ses düzeyi:** varsayılan %100
- **Alarm sesi:** Siren, iPhone 1 (Radar tarzı), iPhone 2 (marimba tarzı) veya kendi dosyanız
- **Alarmı dene:** test tonu
- **5 dk sessiz:** geçici susturma

Eşik dolana kadar sessizdir. Yanıtlayınca sol rozet sıfırlanır; eklenti de **0** gösterir. Sayaç sohbet listesi açıkken çalışır; o sekme açık kaldığı sürece diğer sekmelerde de arkada izler.

## Desteklenen zaman biçimleri

| Biçim | Örnek | Saniye |
| --- | --- | --- |
| `Xs` | `12s` | 12 |
| `Xm` | `2m` | 120 |
| `XmYs` | `2m15s` | 135 |

## Gizlilik

Ayarlar tarayıcıda kalır. Sohbet içeriği dışarı gönderilmez.
